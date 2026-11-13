import crypto from 'node:crypto';

const BIZBOX_BASE = 'http://ngw.stent.net';
const AES_KEY = Buffer.from('BsI&EkJZUzO2HhdI', 'utf8');

function encryptBizbox(plainText) {
  const cipher = crypto.createCipheriv('aes-128-cbc', AES_KEY, AES_KEY);
  let encrypted = cipher.update(String(plainText), 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encodeURIComponent('!' + encrypted);
}

function stripTags(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function createSessionClient() {
  const cookieJar = [];

  const saveCookies = (res) => {
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const raw of setCookies) {
      const parts = raw.split(';').map((p) => p.trim());
      const [kv, ...attrs] = parts;
      const eq = kv.indexOf('=');
      if (eq <= 0) continue;
      const name = kv.slice(0, eq);
      const value = kv.slice(eq + 1);
      let cPath = '/';
      for (const attr of attrs) {
        if (/^path=/i.test(attr)) cPath = attr.slice(5) || '/';
      }
      const existingIdx = cookieJar.findIndex((c) => c.name === name && c.path === cPath);
      if (existingIdx >= 0) cookieJar[existingIdx].value = value;
      else cookieJar.push({ name, value, path: cPath });
    }
  };

  const getCookieHeader = (urlStr) => {
    const u = new URL(urlStr);
    return cookieJar
      .filter((c) => u.pathname.startsWith(c.path))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  };

  return async function request(urlStr, opts = {}) {
    let currentUrl = urlStr;
    let currentOpts = { ...opts };

    for (let hop = 0; hop < 10; hop++) {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(currentOpts.headers || {})
      };
      const cookieStr = getCookieHeader(currentUrl);
      if (cookieStr) headers.Cookie = cookieStr;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      let res;
      try {
        res = await fetch(currentUrl, {
          ...currentOpts,
          headers,
          redirect: 'manual',
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }

      saveCookies(res);

      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        currentUrl = new URL(res.headers.get('location'), currentUrl).toString();
        currentOpts = { method: 'GET' };
        continue;
      }

      const text = await res.text();
      return { res, finalUrl: currentUrl, text };
    }

    throw new Error('리다이렉트 횟수를 초과했습니다.');
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let body = {};
  if (req.body) {
    if (typeof req.body === 'string') {
      try {
        body = JSON.parse(req.body);
      } catch {
        body = {};
      }
    } else {
      body = req.body;
    }
  }

  const bizboxId = (body.bizboxId || process.env.BIZBOX_ID || '').trim();
  const bizboxPw = body.bizboxPw || process.env.BIZBOX_PW || '';
  const projectId = (process.env.VITE_FIREBASE_PROJECT_ID || body.projectId || '').trim();
  const apiKey = (process.env.VITE_FIREBASE_API_KEY || body.apiKey || '').trim();

  if (!bizboxId || !bizboxPw) {
    return res.status(401).json({
      ok: false,
      code: 'NEEDS_CREDENTIALS',
      message: '그룹웨어 연동을 위해 최초 1회 계정 설정이 필요합니다.'
    });
  }

  if (!projectId || !apiKey) {
    return res.status(500).json({
      ok: false,
      code: 'MISSING_FIREBASE_CONFIG',
      message: 'Firebase 프로젝트 설정을 찾을 수 없습니다.'
    });
  }

  try {
    const request = createSessionClient();

    // 1. 초기 세션 발급
    await request(`${BIZBOX_BASE}/gw/uat/uia/egovLoginUsr.do`);

    // 2. AES 암호화 후 로그인 요청
    const encryptedId = encryptBizbox(bizboxId);
    let uid0 = encryptedId;
    let uid1 = '';
    let uid2 = '';
    if (uid0.length > 50) {
      uid1 = uid0.slice(50);
      uid0 = uid0.slice(0, 50);
      if (uid1.length > 50) {
        uid2 = uid1.slice(50);
        uid1 = uid1.slice(0, 50);
      }
    }

    const loginStep = await request(`${BIZBOX_BASE}/gw/uat/uia/actionLogin.do`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        isScLogin: '',
        scUserId: '',
        scUserPwd: '',
        id: uid0,
        id_sub1: uid1,
        id_sub2: uid2,
        password: encryptBizbox(bizboxPw)
      }).toString()
    });

    const actionMatch = loginStep.text.match(/action=['"]([^'"]+)['"]/i);
    if (!actionMatch || !actionMatch[1].includes('j_spring_security_check')) {
      if (loginStep.text.includes('접속 할 수 없는 IP대역')) {
        return res.status(403).json({
          ok: false,
          code: 'IP_RESTRICTED',
          message: '그룹웨어에서 외부 서버 IP 접근을 제한하고 있습니다.'
        });
      }
      return res.status(401).json({
        ok: false,
        code: 'AUTH_FAILED',
        message: '그룹웨어 아이디 또는 비밀번호가 일치하지 않습니다. 비밀번호가 변경되었는지 확인해주세요.'
      });
    }

    const hiddenInputs = [...loginStep.text.matchAll(/<input[^>]*name=['"]([^'"]+)['"][^>]*value=['"]([^'"]*)['"]/gi)];
    const securityBody = new URLSearchParams();
    for (const match of hiddenInputs) {
      securityBody.append(match[1], match[2]);
    }

    await request(new URL(actionMatch[1], loginStep.finalUrl).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: securityBody.toString()
    });

    // 3. 결재함 통합 스캔 (과거 3개월 ~ 향후 4개월)
    const now = new Date();
    const past = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const future = new Date(now.getFullYear(), now.getMonth() + 4, 0);
    const formatDt = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    // 기결함, 상신함, 미결함, 진행함, 수신참조함, 참조/열람함
    const menuIDs = ['2002060000', '2002010000', '2002020000', '2002030000', '2002090000', '2002120000'];

    const listResponses = await Promise.all(
      menuIDs.map((menuID) =>
        request(`${BIZBOX_BASE}/eap/ea/eadoc/GetEaDocList.do`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            nMenuID: menuID,
            sfrDt: formatDt(past),
            stoDt: formatDt(future),
            page: '1',
            pageSize: '500'
          }).toString()
        })
      )
    );

    const seenDocIds = new Set();
    const uniqueDocs = [];

    for (const lr of listResponses) {
      let json = {};
      try {
        json = JSON.parse(lr.text);
      } catch {
        continue;
      }
      for (const docItem of json.list || []) {
        const formName = docItem.FORM_NM || '';
        if (!(formName.includes('휴가') || formName.includes('연차') || formName.includes('근태'))) continue;
        // 반려(50), 회수(60), 삭제(110) 문서 제외
        if (['50', '60', '110'].includes(String(docItem.DOC_STS))) continue;
        if (formName.includes('취소') || (docItem.DOC_TITLE || '').includes('취소')) continue;

        if (!seenDocIds.has(docItem.DOC_ID)) {
          seenDocIds.add(docItem.DOC_ID);
          uniqueDocs.push(docItem);
        }
      }
    }

    // 오래된 문서부터 최신 문서 순으로 정렬 (동일 일자 재상신 시 최신 본문 우선)
    uniqueDocs.sort((a, b) => Number(a.DOC_ID) - Number(b.DOC_ID));

    // 4. 문서 상세 HTML 병렬 파싱
    const extractedItems = [];
    const BATCH_SIZE = 8;

    for (let i = 0; i < uniqueDocs.length; i += BATCH_SIZE) {
      const batch = uniqueDocs.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (docItem) => {
          try {
            const detailRes = await request(`${BIZBOX_BASE}/eap/Ea/EADocPop/EAAppDocV.do`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
              body: new URLSearchParams({
                doc_id: String(docItem.DOC_ID),
                form_id: String(docItem.FORM_ID),
                bindType: 'V',
                newYn: '',
                p_doc_id: '0',
                doc_auth: '-1',
                spDocId: `${docItem.DOC_ID};0`,
                setReadYn: 'N'
              }).toString()
            });

            const detailJson = JSON.parse(detailRes.text);
            const html = detailJson.html || '';
            const stmtMatch = html.match(/<table[^>]*class=['"][^'"]*statement[^'"]*['"][\s\S]*?<\/table>/i);
            const tableHtml = stmtMatch ? stmtMatch[0] : html;
            const trMatches = [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)];

            const rows = [];
            for (const tr of trMatches) {
              const tds = [...tr[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]));
              const dateIdx = tds.findIndex((t) => /^\d{4}-\d{2}-\d{2}$/.test(t));
              if (dateIdx >= 1) {
                const startDate = tds[dateIdx];
                const endCandidate = tds[dateIdx + 1];
                const endDate = /^\d{4}-\d{2}-\d{2}$/.test(endCandidate) ? endCandidate : startDate;
                rows.push({
                  name: (docItem.USER_NM || '').trim(),
                  category: 'vacation',
                  type: tds[dateIdx - 1] || '휴가',
                  startDate,
                  endDate,
                  memo: tds[dateIdx + 4] !== undefined ? tds[dateIdx + 4] : tds[tds.length - 1] || ''
                });
              }
            }
            return rows;
          } catch {
            return [];
          }
        })
      );

      for (const rows of batchResults) {
        extractedItems.push(...rows);
      }
    }

    // 5. Firestore 일괄 반영 (REST Batch Commit)
    const docMap = new Map();
    for (const item of extractedItems) {
      if (!item.name || !/^\d{4}-\d{2}-\d{2}$/.test(item.startDate)) continue;
      const docId = `${item.name}_${item.startDate}_${item.endDate}`.replace(/\//g, '-');
      docMap.set(docId, item);
    }

    const syncedAt = new Date().toISOString();
    const allWrites = Array.from(docMap.entries()).map(([docId, item]) => ({
      update: {
        name: `projects/${projectId}/databases/(default)/documents/schedules/${encodeURIComponent(docId)}`,
        fields: {
          name: { stringValue: item.name },
          category: { stringValue: 'vacation' },
          type: { stringValue: item.type },
          startDate: { stringValue: item.startDate },
          endDate: { stringValue: item.endDate },
          memo: { stringValue: item.memo }
        }
      }
    }));

    allWrites.push({
      update: {
        name: `projects/${projectId}/databases/(default)/documents/meta/syncStatus`,
        fields: {
          lastSyncedAt: { stringValue: syncedAt },
          syncedCount: { integerValue: String(docMap.size) },
          scannedDocs: { integerValue: String(uniqueDocs.length) }
        }
      }
    });

    for (let i = 0; i < allWrites.length; i += 400) {
      const chunk = allWrites.slice(i, i + 400);
      const commitRes = await fetch(
        `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ writes: chunk })
        }
      );

      if (!commitRes.ok) {
        const errTxt = await commitRes.text();
        throw new Error(`Firestore 저장 실패: ${errTxt}`);
      }
    }

    return res.status(200).json({
      ok: true,
      syncedAt,
      scannedDocs: uniqueDocs.length,
      syncedCount: docMap.size
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      code: 'SYNC_ERROR',
      message: err.message || '동기화 중 오류가 발생했습니다.'
    });
  }
}
