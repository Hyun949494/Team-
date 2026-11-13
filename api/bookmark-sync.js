export default function handler(req, res) {
  const projectId = (process.env.VITE_FIREBASE_PROJECT_ID || '').trim();
  const apiKey = (process.env.VITE_FIREBASE_API_KEY || '').trim();
  const appOrigin = `https://${req.headers.host || 'team-five-nu.vercel.app'}`;

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const script = `(function() {
  var PROJECT_ID = ${JSON.stringify(projectId)};
  var API_KEY = ${JSON.stringify(apiKey)};
  var APP_URL = ${JSON.stringify(appOrigin)};

  function showToast(msg, isError, showLink) {
    var el = document.getElementById('__tw_vac_sync_toast__');
    if (!el) {
      el = document.createElement('div');
      el.id = '__tw_vac_sync_toast__';
      el.style.cssText = 'position:fixed;top:20px;right:20px;z-index:2147483647;background:#111827;color:#ffffff;padding:13px 18px;border-radius:10px;font-family:Pretendard,-apple-system,BlinkMacSystemFont,"Malgun Gothic",sans-serif;font-size:13.5px;font-weight:600;box-shadow:0 16px 36px rgba(0,0,0,0.28);display:flex;align-items:center;gap:12px;letter-spacing:-0.01em;transition:opacity 0.25s ease;';
      document.body.appendChild(el);
    }
    el.style.background = isError ? '#991b1b' : '#111827';
    el.style.opacity = '1';
    el.innerHTML = '<span>' + msg + '</span>' + (showLink ? '<a href="' + APP_URL + '" target="_blank" style="color:#34d399;text-decoration:none;font-weight:700;margin-left:4px;white-space:nowrap;">일정 보드 열기 ↗</a>' : '');
  }

  function hideToastAfter(ms) {
    setTimeout(function() {
      var el = document.getElementById('__tw_vac_sync_toast__');
      if (el) {
        el.style.opacity = '0';
        setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
      }
    }, ms);
  }

  if (window.location.hostname !== 'ngw.stent.net') {
    if (window.confirm('비즈박스 그룹웨어(ngw.stent.net) 화면에서 눌러주셔야 휴가 내역을 불러올 수 있습니다.\\n\\n지금 그룹웨어 페이지를 여시겠습니까?')) {
      window.open('http://ngw.stent.net', '_blank');
    }
    return;
  }

  if (window.__twSyncRunning__) {
    showToast('이미 동기화가 진행 중입니다...', false, false);
    return;
  }
  window.__twSyncRunning__ = true;
  showToast('그룹웨어 결재함에서 최신 휴가 내역을 스캔하는 중...', false, false);

  (async function() {
    try {
      var now = new Date();
      var past = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      var future = new Date(now.getFullYear(), now.getMonth() + 4, 0);
      var fmt = function(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      };

      var menuIDs = ['2002060000', '2002010000', '2002020000', '2002030000', '2002090000', '2002120000'];
      var listResponses = await Promise.all(menuIDs.map(function(menuID) {
        var fd = new URLSearchParams();
        fd.append('nMenuID', menuID);
        fd.append('sfrDt', fmt(past));
        fd.append('stoDt', fmt(future));
        fd.append('page', '1');
        fd.append('pageSize', '500');
        return fetch('/eap/ea/eadoc/GetEaDocList.do', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          body: fd.toString()
        }).then(function(r) { return r.text(); });
      }));

      var seenIds = new Set();
      var uniqueDocs = [];
      var validJsonCount = 0;

      for (var m = 0; m < listResponses.length; m++) {
        var json;
        try {
          json = JSON.parse(listResponses[m]);
          validJsonCount++;
        } catch (e) {
          continue;
        }
        var list = json.list || [];
        for (var k = 0; k < list.length; k++) {
          var docItem = list[k];
          var formNm = docItem.FORM_NM || '';
          if (!(formNm.indexOf('휴가') !== -1 || formNm.indexOf('연차') !== -1 || formNm.indexOf('근태') !== -1)) continue;
          var sts = String(docItem.DOC_STS || '');
          if (sts === '50' || sts === '60' || sts === '110') continue;
          if (formNm.indexOf('취소') !== -1 || String(docItem.DOC_TITLE || '').indexOf('취소') !== -1) continue;
          if (!seenIds.has(docItem.DOC_ID)) {
            seenIds.add(docItem.DOC_ID);
            uniqueDocs.push(docItem);
          }
        }
      }

      if (validJsonCount === 0) {
        throw new Error('그룹웨어에 먼저 로그인한 상태에서 다시 눌러주세요.');
      }

      uniqueDocs.sort(function(a, b) { return Number(a.DOC_ID) - Number(b.DOC_ID); });
      showToast('휴가 문서 ' + uniqueDocs.length + '건 상세 분석 중...', false, false);

      var parser = new DOMParser();
      var extracted = [];

      for (var i = 0; i < uniqueDocs.length; i += 8) {
        var batch = uniqueDocs.slice(i, i + 8);
        var batchRows = await Promise.all(batch.map(async function(docItem) {
          try {
            var bodyParams = new URLSearchParams({
              doc_id: String(docItem.DOC_ID),
              form_id: String(docItem.FORM_ID),
              bindType: 'V',
              newYn: '',
              p_doc_id: '0',
              doc_auth: '-1',
              spDocId: docItem.DOC_ID + ';0',
              setReadYn: 'N'
            });
            var r = await fetch('/eap/Ea/EADocPop/EAAppDocV.do', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
              body: bodyParams.toString()
            });
            var detail = await r.json();
            var dom = parser.parseFromString(detail.html || '', 'text/html');
            var trs = dom.querySelectorAll('.statement tbody tr, .statement tr');
            var rows = [];
            for (var rIdx = 0; rIdx < trs.length; rIdx++) {
              var tds = Array.from(trs[rIdx].querySelectorAll('td')).map(function(td) {
                return (td.textContent || '').replace(/\\s+/g, ' ').trim();
              });
              var dateIdx = tds.findIndex(function(t) { return /^\\d{4}-\\d{2}-\\d{2}$/.test(t); });
              if (dateIdx >= 1) {
                var sDate = tds[dateIdx];
                var eRaw = tds[dateIdx + 1];
                var eDate = /^\\d{4}-\\d{2}-\\d{2}$/.test(eRaw) ? eRaw : sDate;
                rows.push({
                  name: String(docItem.USER_NM || '').trim(),
                  type: tds[dateIdx - 1] || '휴가',
                  startDate: sDate,
                  endDate: eDate,
                  memo: tds[dateIdx + 4] !== undefined ? tds[dateIdx + 4] : (tds[tds.length - 1] || '')
                });
              }
            }
            return rows;
          } catch (err) {
            return [];
          }
        }));
        for (var b = 0; b < batchRows.length; b++) {
          extracted = extracted.concat(batchRows[b]);
        }
      }

      var docMap = new Map();
      for (var x = 0; x < extracted.length; x++) {
        var item = extracted[x];
        if (!item.name || !/^\\d{4}-\\d{2}-\\d{2}$/.test(item.startDate)) continue;
        var docId = (item.name + '_' + item.startDate + '_' + item.endDate).replace(/\\//g, '-');
        docMap.set(docId, item);
      }

      var syncedAt = new Date().toISOString();
      var writes = [];
      docMap.forEach(function(val, key) {
        writes.push({
          update: {
            name: 'projects/' + PROJECT_ID + '/databases/(default)/documents/schedules/' + encodeURIComponent(key),
            fields: {
              name: { stringValue: val.name },
              category: { stringValue: 'vacation' },
              type: { stringValue: val.type },
              startDate: { stringValue: val.startDate },
              endDate: { stringValue: val.endDate },
              memo: { stringValue: val.memo }
            }
          }
        });
      });

      writes.push({
        update: {
          name: 'projects/' + PROJECT_ID + '/databases/(default)/documents/meta/syncStatus',
          fields: {
            lastSyncedAt: { stringValue: syncedAt },
            syncedCount: { integerValue: String(docMap.size) },
            scannedDocs: { integerValue: String(uniqueDocs.length) }
          }
        }
      });

      for (var c = 0; c < writes.length; c += 400) {
        var chunk = writes.slice(c, c + 400);
        var commitRes = await fetch('https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents:commit?key=' + API_KEY, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ writes: chunk })
        });
        if (!commitRes.ok) {
          throw new Error('데이터베이스 저장 중 오류가 발생했습니다.');
        }
      }

      showToast('✓ 동기화 완료 · 휴가 ' + docMap.size + '건 반영됨', false, true);
      hideToastAfter(6000);
    } catch (err) {
      showToast('동기화 실패: ' + (err.message || '오류가 발생했습니다.'), true, false);
      hideToastAfter(6000);
    } finally {
      window.__twSyncRunning__ = false;
    }
  })();
})();`;

  return res.status(200).send(script);
}
