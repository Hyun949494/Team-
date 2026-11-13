import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  format,
  startOfWeek,
  endOfWeek,
  addDays,
  startOfMonth,
  endOfMonth,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  parseISO,
  differenceInCalendarDays
} from 'date-fns';
import { ko } from 'date-fns/locale';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar as CalendarIcon,
  RefreshCw,
  Search,
  X,
  ExternalLink,
  Copy
} from 'lucide-react';
import { collection, onSnapshot, addDoc, deleteDoc, doc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import './App.css';
import './index.css';

const TEAM_MEMBERS = [
  '조은애',
  '김충현',
  '김두현',
  '정연철',
  '김수환',
  '김지훈',
  '오수민',
  '이수정',
  '장은지',
  '개발4팀'
];

const CATEGORIES = [
  { key: 'vacation', label: '휴가' },
  { key: 'outside', label: '외근' },
  { key: 'meeting', label: '회의' },
  { key: 'training', label: '교육' },
  { key: 'other', label: '기타' }
];

const CATEGORY_ORDER = {
  vacation: 1,
  outside: 2,
  meeting: 3,
  training: 4,
  other: 5
};

const getCategoryLabel = (cat) => {
  const found = CATEGORIES.find((c) => c.key === cat);
  return found ? found.label : cat || '기타';
};

const isValidDateStr = (str) => typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str);

const splitNames = (nameStr) =>
  String(nameStr || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const formatWhoLabel = (nameStr, compact = false) => {
  const list = splitNames(nameStr);
  if (list.length === 0) return '미지정';
  if (list.length === 1) return list[0];
  if (compact) {
    return `${list[0]} 외 ${list.length - 1}`;
  }
  if (list.length <= 2) {
    return list.join(', ');
  }
  return `${list[0]}, ${list[1]} 외 ${list.length - 2}명`;
};

function App() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [focusedDate, setFocusedDate] = useState(new Date());
  const [schedules, setSchedules] = useState([]);
  const [selectedMember, setSelectedMember] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileTab, setMobileTab] = useState('calendar');
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );

  // Modals
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [modalTargetDate, setModalTargetDate] = useState(null);
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isSyncConfigOpen, setIsSyncConfigOpen] = useState(false);

  // Sync state
  const [syncMeta, setSyncMeta] = useState(null);

  // Toast state
  const [toasts, setToasts] = useState([]);

  const pushToast = useCallback((message, type = 'info') => {
    const id = `${Date.now()}_${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3400);
  }, []);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Firestore real-time listeners
  useEffect(() => {
    if (!db) return;

    const unsubSchedules = onSnapshot(collection(db, 'schedules'), (snapshot) => {
      const rows = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((s) => isValidDateStr(s.startDate) && isValidDateStr(s.endDate));
      setSchedules(rows);
    });

    const unsubMeta = onSnapshot(doc(db, 'meta', 'syncStatus'), (snap) => {
      if (snap.exists()) {
        setSyncMeta(snap.data());
      }
    });

    return () => {
      unsubSchedules();
      unsubMeta();
    };
  }, []);

  const handleSaveSchedule = async (scheduleData) => {
    try {
      if (db) {
        if (scheduleData.id) {
          const { id, ...rest } = scheduleData;
          await setDoc(doc(db, 'schedules', id), rest, { merge: true });
          pushToast('일정이 수정되었습니다.');
        } else {
          const { id: _id, ...rest } = scheduleData;
          await addDoc(collection(db, 'schedules'), rest);
          pushToast('새 일정이 등록되었습니다.');
        }
      } else {
        if (scheduleData.id) {
          setSchedules((prev) => prev.map((s) => (s.id === scheduleData.id ? scheduleData : s)));
        } else {
          setSchedules((prev) => [...prev, { ...scheduleData, id: String(Date.now()) }]);
        }
        pushToast('일정이 저장되었습니다.');
      }
      setIsFormOpen(false);
      setSelectedSchedule(null);
    } catch (error) {
      pushToast(`저장 실패: ${error.message}`, 'error');
    }
  };

  const handleDeleteSchedule = async (id) => {
    try {
      if (db) {
        await deleteDoc(doc(db, 'schedules', id));
      } else {
        setSchedules((prev) => prev.filter((s) => s.id !== id));
      }
      setIsDetailOpen(false);
      setSelectedSchedule(null);
      pushToast('일정이 삭제되었습니다.');
    } catch (error) {
      pushToast(`삭제 실패: ${error.message}`, 'error');
    }
  };

  // Filtered schedules (member + category + search)
  const memberAndSearchFiltered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return schedules.filter((s) => {
      if (selectedMember !== 'all') {
        const names = splitNames(s.name);
        const matchesMember =
          selectedMember === '개발4팀'
            ? names.includes('개발4팀')
            : names.includes(selectedMember) || names.includes('개발4팀');
        if (!matchesMember) return false;
      }

      if (q) {
        const hay = `${s.name || ''} ${s.type || ''} ${s.memo || ''} ${getCategoryLabel(s.category)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [schedules, selectedMember, searchQuery]);

  const filteredSchedules = useMemo(() => {
    if (selectedCategory === 'all') return memberAndSearchFiltered;
    return memberAndSearchFiltered.filter((s) => s.category === selectedCategory);
  }, [memberAndSearchFiltered, selectedCategory]);

  // Active month statistics (based on member/search filter so counts stay informative)
  const monthStats = useMemo(() => {
    const mStart = startOfMonth(currentDate);
    const mEnd = endOfMonth(currentDate);
    const counts = { vacation: 0, outside: 0, meeting: 0, training: 0, other: 0 };

    for (const s of memberAndSearchFiltered) {
      const sStart = parseISO(s.startDate);
      const sEnd = parseISO(s.endDate);
      if (sEnd >= mStart && sStart <= mEnd) {
        const key = counts[s.category] !== undefined ? s.category : 'other';
        counts[key] += 1;
      }
    }
    return counts;
  }, [memberAndSearchFiltered, currentDate]);

  const getSchedulesForDay = useCallback(
    (dayDate) => {
      const dayStr = format(dayDate, 'yyyy-MM-dd');
      return filteredSchedules
        .filter((s) => s.startDate <= dayStr && s.endDate >= dayStr)
        .sort((a, b) => {
          const spanA = a.startDate !== a.endDate ? 0 : 1;
          const spanB = b.startDate !== b.endDate ? 0 : 1;
          if (spanA !== spanB) return spanA - spanB;
          const catA = CATEGORY_ORDER[a.category] || 9;
          const catB = CATEGORY_ORDER[b.category] || 9;
          if (catA !== catB) return catA - catB;
          return (a.name || '').localeCompare(b.name || '', 'ko');
        });
    },
    [filteredSchedules]
  );

  const todaySchedules = useMemo(() => getSchedulesForDay(new Date()), [getSchedulesForDay]);
  const focusedDaySchedules = useMemo(
    () => getSchedulesForDay(focusedDate),
    [getSchedulesForDay, focusedDate]
  );

  const upcomingSchedules = useMemo(() => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    return filteredSchedules
      .filter((s) => s.endDate >= todayStr)
      .sort((a, b) => {
        if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
        return (CATEGORY_ORDER[a.category] || 9) - (CATEGORY_ORDER[b.category] || 9);
      })
      .slice(0, 20);
  }, [filteredSchedules]);

  const formattedSyncTime = useMemo(() => {
    if (!syncMeta?.lastSyncedAt) return '동기화 대기';
    const d = new Date(syncMeta.lastSyncedAt);
    if (isNaN(d.getTime())) return '동기화 대기';
    return `최근 동기화 ${format(d, 'MM.dd HH:mm')}`;
  }, [syncMeta]);

  const openCreateModal = (targetDay) => {
    setModalTargetDate(targetDay || new Date());
    setSelectedSchedule(null);
    setIsFormOpen(true);
  };

  const renderCalendarWeeks = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(monthStart);
    const gridStart = startOfWeek(monthStart);
    const gridEnd = endOfWeek(monthEnd);

    const weekRows = [];
    let cursor = gridStart;

    while (cursor <= gridEnd) {
      const cells = [];
      for (let dow = 0; dow < 7; dow++) {
        const cellDate = cursor;
        const dateKey = format(cellDate, 'yyyy-MM-dd');
        const inMonth = isSameMonth(cellDate, monthStart);
        const isToday = isSameDay(cellDate, new Date());
        const isFocused = isMobile && isSameDay(cellDate, focusedDate);

        const dayEvents = getSchedulesForDay(cellDate);
        const maxVisible = isMobile ? 3 : 7;
        const visibleEvents = dayEvents.slice(0, maxVisible);
        const hiddenCount = dayEvents.length - visibleEvents.length;

        const dowClass = dow === 0 ? 'sun' : dow === 6 ? 'sat' : '';

        cells.push(
          <div
            key={dateKey}
            className={`day-cell ${dowClass} ${!inMonth ? 'outside-month' : ''} ${
              isToday ? 'is-today' : ''
            } ${isFocused ? 'is-focused' : ''}`}
            onClick={() => {
              setFocusedDate(cellDate);
              if (!isMobile) {
                openCreateModal(cellDate);
              }
            }}
          >
            <div className="day-top">
              <div className="day-num-group">
                <span className="day-num">{format(cellDate, 'd')}</span>
                {isToday && <span className="today-tag">오늘</span>}
              </div>
              <button
                type="button"
                className="cell-quick-add"
                title="이 날짜에 일정 등록"
                onClick={(e) => {
                  e.stopPropagation();
                  openCreateModal(cellDate);
                }}
              >
                <Plus size={13} />
              </button>
            </div>

            <div className="cell-events">
              {visibleEvents.map((ev) => {
                const isStart = ev.startDate === dateKey || dow === 0;
                const isEnd = ev.endDate === dateKey || dow === 6;
                let spanClass = 'span-mid';
                if (isStart && isEnd) spanClass = 'span-single';
                else if (isStart) spanClass = 'span-start';
                else if (isEnd) spanClass = 'span-end';

                const subText =
                  ev.category === 'vacation'
                    ? ev.type || '휴가'
                    : ev.memo || getCategoryLabel(ev.category);

                return (
                  <div
                    key={ev.id}
                    className={`event-chip cat-${ev.category || 'other'} ${spanClass}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isMobile) {
                        setFocusedDate(cellDate);
                      }
                      setSelectedSchedule(ev);
                      setIsDetailOpen(true);
                    }}
                    title={`${ev.name} · ${ev.type || getCategoryLabel(ev.category)}${
                      ev.memo ? ` — ${ev.memo}` : ''
                    }`}
                  >
                    <div className="event-text">
                      <span className="event-who">{formatWhoLabel(ev.name, isMobile)}</span>
                      {subText && <span className="event-sub">{subText}</span>}
                    </div>
                  </div>
                );
              })}

              {hiddenCount > 0 && <div className="more-events-tag">+{hiddenCount}건 더보기</div>}
            </div>
          </div>
        );

        cursor = addDays(cursor, 1);
      }

      weekRows.push(
        <div className="week-row" key={format(cursor, 'yyyy-MM-dd')}>
          {cells}
        </div>
      );
    }

    return <div className="calendar-weeks">{weekRows}</div>;
  };

  return (
    <div className="workspace-shell">
      {/* Top Bar */}
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-group">
            <div className="brand-mark">
              <CalendarIcon size={18} strokeWidth={2.2} />
            </div>
            <div className="brand-titles">
              <span className="brand-eyebrow">TAEWOONG MEDICAL · R&amp;D DIV. 4</span>
              <h1 className="brand-name">개발4팀 일정 보드</h1>
            </div>
          </div>

          <div className="topbar-actions">
            <div className="sync-cluster">
              <span className="sync-status-text">
                <span className={`status-dot ${syncMeta?.lastSyncedAt ? '' : 'idle'}`} />
                {formattedSyncTime}
              </span>
              <button
                type="button"
                className="btn-sync"
                onClick={() => setIsSyncConfigOpen(true)}
                title="파일 설치 없이 그룹웨어 휴가 내역을 원클릭 동기화합니다"
              >
                <RefreshCw size={14} />
                <span>그룹웨어 동기화</span>
              </button>
            </div>

            <button
              type="button"
              className="btn-create"
              onClick={() => openCreateModal(focusedDate || new Date())}
            >
              <Plus size={15} strokeWidth={2.4} />
              <span>일정 등록</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="workspace-body">
        {/* Member Filter & Search Bar */}
        <section className="filter-bar">
          <div className="member-filter-scroll">
            <button
              type="button"
              className={`filter-pill ${selectedMember === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedMember('all')}
            >
              전체 팀원
            </button>
            {TEAM_MEMBERS.map((member) => (
              <button
                key={member}
                type="button"
                className={`filter-pill ${member === '개발4팀' ? 'team-pill' : ''} ${
                  selectedMember === member ? 'active' : ''
                }`}
                onClick={() =>
                  setSelectedMember((prev) => (prev === member ? 'all' : member))
                }
              >
                {member}
              </button>
            ))}
          </div>

          <div className="search-box">
            <Search size={14} />
            <input
              type="text"
              className="search-input"
              placeholder="이름, 메모, 구분 검색"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="검색어 지우기"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </section>

        {/* Mobile Switcher */}
        <div className="mobile-view-tabs">
          <button
            type="button"
            className={`mobile-tab-btn ${mobileTab === 'calendar' ? 'active' : ''}`}
            onClick={() => setMobileTab('calendar')}
          >
            월간 캘린더
          </button>
          <button
            type="button"
            className={`mobile-tab-btn ${mobileTab === 'agenda' ? 'active' : ''}`}
            onClick={() => setMobileTab('agenda')}
          >
            오늘 · 예정 일정
          </button>
        </div>

        <div className="content-grid">
          {/* Calendar Sheet */}
          <section
            className={`calendar-sheet ${
              isMobile && mobileTab !== 'calendar' ? 'mobile-hidden' : ''
            }`}
          >
            <div className="calendar-toolbar">
              <div className="month-nav-group">
                <h2 className="month-heading">{format(currentDate, 'yyyy년 M월')}</h2>
                <div className="segmented-nav">
                  <button
                    type="button"
                    className="seg-btn"
                    onClick={() => setCurrentDate(subMonths(currentDate, 1))}
                    aria-label="이전 달"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    type="button"
                    className="seg-btn"
                    onClick={() => {
                      const now = new Date();
                      setCurrentDate(now);
                      setFocusedDate(now);
                    }}
                  >
                    오늘
                  </button>
                  <button
                    type="button"
                    className="seg-btn"
                    onClick={() => setCurrentDate(addMonths(currentDate, 1))}
                    aria-label="다음 달"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>

              <div className="category-pills">
                <button
                  type="button"
                  className={`cat-filter-btn ${selectedCategory === 'all' ? 'active' : ''}`}
                  onClick={() => setSelectedCategory('all')}
                >
                  전체
                </button>
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.key}
                    type="button"
                    className={`cat-filter-btn ${selectedCategory === cat.key ? 'active' : ''}`}
                    onClick={() =>
                      setSelectedCategory((prev) => (prev === cat.key ? 'all' : cat.key))
                    }
                  >
                    <span className={`cat-dot ${cat.key}`} />
                    <span>{cat.label}</span>
                    <span className="cat-count">{monthStats[cat.key] || 0}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="weekday-row">
              {['일', '월', '화', '수', '목', '금', '토'].map((label, idx) => (
                <div
                  key={label}
                  className={`weekday-cell ${idx === 0 ? 'sun' : idx === 6 ? 'sat' : ''}`}
                >
                  {label}
                </div>
              ))}
            </div>

            {renderCalendarWeeks()}

            {/* Mobile Selected Day Sheet */}
            <div className="mobile-day-inspector">
              <div className="inspector-header">
                <span className="inspector-title">
                  {format(focusedDate, 'M월 d일 (EEEE)', { locale: ko })}
                </span>
                <button
                  type="button"
                  className="btn-inline-add"
                  onClick={() => openCreateModal(focusedDate)}
                >
                  <Plus size={13} />
                  <span>일정 추가</span>
                </button>
              </div>

              {focusedDaySchedules.length === 0 ? (
                <p className="inspector-empty">선택한 날짜에 등록된 일정이 없습니다.</p>
              ) : (
                <div className="inspector-list">
                  {focusedDaySchedules.map((item) => (
                    <AgendaCard
                      key={item.id}
                      schedule={item}
                      onClick={() => {
                        setSelectedSchedule(item);
                        setIsDetailOpen(true);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Right Executive Panel */}
          <aside
            className={`side-panel ${
              isMobile && mobileTab !== 'agenda' ? 'mobile-hidden' : ''
            }`}
          >
            {/* Today's Status */}
            <div className="panel-card">
              <div className="panel-card-header">
                <h3 className="panel-card-title">오늘 현황</h3>
                <span className="panel-card-meta">
                  {format(new Date(), 'M월 d일 EEEE', { locale: ko })}
                </span>
              </div>
              {todaySchedules.length === 0 ? (
                <p className="panel-empty">오늘 등록된 부재·외근 일정이 없습니다.</p>
              ) : (
                <div className="agenda-list">
                  {todaySchedules.map((item) => (
                    <AgendaCard
                      key={item.id}
                      schedule={item}
                      compactDate
                      onClick={() => {
                        setSelectedSchedule(item);
                        setIsDetailOpen(true);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Monthly KPI Summary */}
            <div className="panel-card">
              <div className="panel-card-header">
                <h3 className="panel-card-title">{format(currentDate, 'M월')} 요약</h3>
                <span className="panel-card-meta">
                  {selectedMember === 'all' ? '전체 기준' : `${selectedMember} 기준`}
                </span>
              </div>
              <div className="kpi-grid">
                <div className="kpi-box">
                  <span className="kpi-label">휴가</span>
                  <span className="kpi-val">{monthStats.vacation}</span>
                </div>
                <div className="kpi-box">
                  <span className="kpi-label">외근</span>
                  <span className="kpi-val">{monthStats.outside}</span>
                </div>
                <div className="kpi-box">
                  <span className="kpi-label">회의</span>
                  <span className="kpi-val">{monthStats.meeting}</span>
                </div>
                <div className="kpi-box">
                  <span className="kpi-label">교육·기타</span>
                  <span className="kpi-val">{monthStats.training + monthStats.other}</span>
                </div>
              </div>
            </div>

            {/* Upcoming Timeline */}
            <div className="panel-card">
              <div className="panel-card-header">
                <h3 className="panel-card-title">다가오는 일정</h3>
                <span className="panel-card-meta">{upcomingSchedules.length}건</span>
              </div>
              {upcomingSchedules.length === 0 ? (
                <p className="panel-empty">예정된 일정이 없습니다.</p>
              ) : (
                <div className="agenda-list">
                  {upcomingSchedules.map((item) => (
                    <AgendaCard
                      key={item.id}
                      schedule={item}
                      onClick={() => {
                        setSelectedSchedule(item);
                        setIsDetailOpen(true);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>

      {/* Modals */}
      {isFormOpen && (
        <ScheduleFormModal
          onClose={() => {
            setIsFormOpen(false);
            setSelectedSchedule(null);
          }}
          onSave={handleSaveSchedule}
          targetDate={modalTargetDate}
          editingSchedule={selectedSchedule}
          activeMemberFilter={selectedMember}
          onToast={pushToast}
        />
      )}

      {isDetailOpen && selectedSchedule && (
        <ScheduleDetailModal
          schedule={selectedSchedule}
          onClose={() => {
            setIsDetailOpen(false);
            setSelectedSchedule(null);
          }}
          onDelete={handleDeleteSchedule}
          onEdit={() => {
            setIsDetailOpen(false);
            setIsFormOpen(true);
          }}
        />
      )}

      {isSyncConfigOpen && (
        <SyncGuideModal
          onClose={() => setIsSyncConfigOpen(false)}
          onToast={pushToast}
        />
      )}

      {/* Toasts */}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((t) => (
            <div key={t.id} className={`toast-item ${t.type === 'error' ? 'error' : ''}`}>
              <span>{t.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AgendaCard({ schedule, onClick, compactDate = false }) {
  const start = parseISO(schedule.startDate);
  const end = parseISO(schedule.endDate);
  const dateLabel = compactDate
    ? schedule.startDate === schedule.endDate
      ? '당일'
      : `${format(start, 'M.d')} – ${format(end, 'M.d')}`
    : schedule.startDate === schedule.endDate
      ? format(start, 'M월 d일 (EEE)', { locale: ko })
      : `${format(start, 'M월 d일', { locale: ko })} – ${format(end, 'M월 d일', { locale: ko })}`;

  return (
    <div className="agenda-item" onClick={onClick}>
      <div className="agenda-top">
        <span className="agenda-date">{dateLabel}</span>
        <span className={`cat-tag cat-${schedule.category || 'other'}`}>
          {schedule.type || getCategoryLabel(schedule.category)}
        </span>
      </div>
      <div className="agenda-who">{schedule.name}</div>
      {schedule.memo && <div className="agenda-memo">{schedule.memo}</div>}
    </div>
  );
}

function ScheduleFormModal({
  onClose,
  onSave,
  targetDate,
  editingSchedule,
  activeMemberFilter,
  onToast
}) {
  const defaultNames = editingSchedule
    ? splitNames(editingSchedule.name)
    : activeMemberFilter && activeMemberFilter !== 'all'
      ? [activeMemberFilter]
      : [];

  const [selectedNames, setSelectedNames] = useState(defaultNames);
  const [category, setCategory] = useState(
    editingSchedule ? editingSchedule.category : 'outside'
  );
  const [startDate, setStartDate] = useState(
    editingSchedule
      ? editingSchedule.startDate
      : format(targetDate || new Date(), 'yyyy-MM-dd')
  );
  const [endDate, setEndDate] = useState(
    editingSchedule
      ? editingSchedule.endDate
      : format(targetDate || new Date(), 'yyyy-MM-dd')
  );
  const [memo, setMemo] = useState(editingSchedule?.memo || '');

  const toggleMember = (member) => {
    if (member === '개발4팀') {
      setSelectedNames((prev) => (prev.includes('개발4팀') ? [] : ['개발4팀']));
      return;
    }
    setSelectedNames((prev) => {
      const withoutTeam = prev.filter((n) => n !== '개발4팀');
      return withoutTeam.includes(member)
        ? withoutTeam.filter((n) => n !== member)
        : [...withoutTeam, member];
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (selectedNames.length === 0) {
      onToast('참여 팀원을 최소 1명 이상 선택해주세요.', 'error');
      return;
    }
    if (startDate > endDate) {
      onToast('종료일은 시작일보다 빠를 수 없습니다.', 'error');
      return;
    }

    const payload = {
      name: selectedNames.join(', '),
      category,
      startDate,
      endDate,
      memo: memo.trim()
    };

    if (editingSchedule?.id) {
      payload.id = editingSchedule.id;
    }

    onSave(payload);
  };

  const manualCategories = [
    { key: 'outside', label: '외근' },
    { key: 'meeting', label: '회의' },
    { key: 'training', label: '교육' },
    { key: 'other', label: '기타' }
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{editingSchedule ? '일정 수정' : '새 일정 등록'}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="field-block">
              <span className="field-label">일정 구분</span>
              <div className="category-segment-grid">
                {manualCategories.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={`cat-choice ${category === c.key ? 'selected' : ''}`}
                    onClick={() => setCategory(c.key)}
                  >
                    <span className={`cat-dot ${c.key}`} />
                    <span>{c.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="date-grid">
              <div className="field-block">
                <label className="field-label">시작일</label>
                <input
                  type="date"
                  className="input-control"
                  value={startDate}
                  onChange={(e) => {
                    const v = e.target.value;
                    setStartDate(v);
                    if (v > endDate) setEndDate(v);
                  }}
                  required
                />
              </div>
              <span className="date-sep">–</span>
              <div className="field-block">
                <div className="field-label-row">
                  <label className="field-label">종료일</label>
                  {startDate !== endDate && (
                    <button
                      type="button"
                      className="text-link-btn"
                      onClick={() => setEndDate(startDate)}
                    >
                      당일로 맞춤
                    </button>
                  )}
                </div>
                <input
                  type="date"
                  className="input-control"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="field-block">
              <div className="field-label-row">
                <span className="field-label">
                  대상 팀원 {selectedNames.length > 0 && `(${selectedNames.length})`}
                </span>
                <div className="field-helper-btns">
                  <button
                    type="button"
                    className="text-link-btn"
                    onClick={() => setSelectedNames(['개발4팀'])}
                  >
                    개발4팀 일괄
                  </button>
                  {selectedNames.length > 0 && (
                    <button
                      type="button"
                      className="text-link-btn"
                      onClick={() => setSelectedNames([])}
                    >
                      선택 해제
                    </button>
                  )}
                </div>
              </div>

              <div className="member-select-grid">
                {TEAM_MEMBERS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`member-select-chip ${
                      selectedNames.includes(m) ? 'selected' : ''
                    }`}
                    onClick={() => toggleMember(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className="field-block">
              <label className="field-label">상세 메모 (선택)</label>
              <input
                type="text"
                className="input-control"
                placeholder="예: (14:00) 부천세종병원 미팅, 연구실 안전점검"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>
          </div>

          <div className="modal-foot">
            <button type="button" className="btn-outline" onClick={onClose}>
              취소
            </button>
            <button type="submit" className="btn-create">
              {editingSchedule ? '변경사항 저장' : '일정 등록'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ScheduleDetailModal({ schedule, onClose, onDelete, onEdit }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const start = parseISO(schedule.startDate);
  const end = parseISO(schedule.endDate);
  const daySpan = differenceInCalendarDays(end, start) + 1;
  const people = splitNames(schedule.name);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>일정 상세</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="detail-meta-row">
            <span className={`cat-tag cat-${schedule.category || 'other'}`}>
              {schedule.type || getCategoryLabel(schedule.category)}
            </span>
            <span className="source-badge">
              {schedule.category === 'vacation' ? '그룹웨어 전자결재 연동' : '직접 등록 일정'}
            </span>
          </div>

          <div className="detail-section">
            <span className="detail-label">일시</span>
            <span className="detail-value">
              {format(start, 'yyyy년 M월 d일 (EEE)', { locale: ko })}
              {schedule.startDate !== schedule.endDate &&
                ` – ${format(end, 'yyyy년 M월 d일 (EEE)', { locale: ko })} (${daySpan}일간)`}
            </span>
          </div>

          <div className="detail-section">
            <span className="detail-label">참여 인원</span>
            <div className="detail-people">
              {people.map((p) => (
                <span key={p} className="person-badge">
                  {p}
                </span>
              ))}
            </div>
          </div>

          {schedule.memo && (
            <div className="detail-section">
              <span className="detail-label">비고 · 상세 내용</span>
              <div className="detail-memo-box">{schedule.memo}</div>
            </div>
          )}
        </div>

        <div className="modal-foot split">
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {!confirmingDelete ? (
              <button
                type="button"
                className="btn-danger-ghost"
                onClick={() => setConfirmingDelete(true)}
              >
                삭제
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-danger-solid"
                  onClick={() => onDelete(schedule.id)}
                >
                  삭제 확인
                </button>
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => setConfirmingDelete(false)}
                >
                  취소
                </button>
              </>
            )}

            {schedule.category !== 'vacation' && !confirmingDelete && (
              <button type="button" className="btn-outline" onClick={onEdit}>
                수정
              </button>
            )}
          </div>

          <button type="button" className="btn-create" onClick={onClose}>
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

function SyncGuideModal({ onClose, onToast }) {
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://team-five-nu.vercel.app';
  const bookmarkletCode = `javascript:(function(){var s=document.createElement('script');s.src='${origin}/api/bookmark-sync?t='+Date.now();document.body.appendChild(s);})();`;

  const setBookmarkHref = useCallback(
    (node) => {
      if (node) {
        node.setAttribute('href', bookmarkletCode);
      }
    },
    [bookmarkletCode]
  );

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(bookmarkletCode);
      onToast('북마크 주소가 복사되었습니다. 즐겨찾기 URL 칸에 붙여넣어 주세요.');
    } catch {
      onToast('복사에 실패했습니다. 위 버튼을 즐겨찾기 바로 끌어다 놓아주세요.', 'error');
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>그룹웨어 원클릭 동기화</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="sync-info-note">
            더 이상 압축파일(.zip)이나 실행파일(.bat)을 주고받으실 필요가 없습니다. 아래 버튼을 브라우저 <strong>즐겨찾기 바</strong>에 한 번만 올려두시면, 그룹웨어 화면에서 클릭 한 번으로 2초 만에 최신 휴가가 반영되며 기능 업데이트도 자동 적용됩니다.
          </div>

          <div className="bookmarklet-stage">
            <a
              ref={setBookmarkHref}
              className="bookmarklet-pill"
              onClick={(e) => {
                e.preventDefault();
                onToast('클릭하지 마시고 마우스로 끌어 브라우저 상단 즐겨찾기 바에 놓아주세요.');
              }}
              title="마우스로 드래그하여 브라우저 상단 북마크 바에 놓으세요"
            >
              <RefreshCw size={14} />
              <span>개발4팀 휴가 동기화</span>
            </a>
            <span className="bookmarklet-caption">
              위 검은색 버튼을 마우스로 끌어 상단 북마크 바(Ctrl+Shift+B)에 놓아주세요
            </span>
          </div>

          <div className="step-guide-list">
            <div className="step-guide-item">
              <span className="step-num">1</span>
              <span>
                크롬 상단에 북마크 바가 안 보이면 <strong>Ctrl + Shift + B</strong>를 눌러 켜주세요.
              </span>
            </div>
            <div className="step-guide-item">
              <span className="step-num">2</span>
              <span>
                위 <strong>[개발4팀 휴가 동기화]</strong> 버튼을 마우스로 끌어서 북마크 바에 올려둡니다. (최초 1회 끝)
              </span>
            </div>
            <div className="step-guide-item">
              <span className="step-num">3</span>
              <span>
                사내 그룹웨어(비즈박스)에 <strong>로그인해 둔 화면</strong>에서 방금 추가한 북마크만 누르면 기결·상신·참조함 휴가가 2초 만에 자동 반영됩니다.
              </span>
            </div>
          </div>
        </div>

        <div className="modal-foot split">
          <button
            type="button"
            className="btn-outline"
            onClick={handleCopyCode}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <Copy size={13} />
            <span>코드 복사</span>
          </button>

          <div style={{ display: 'flex', gap: '8px' }}>
            <a
              href="http://ngw.stent.net"
              target="_blank"
              rel="noreferrer"
              className="btn-outline"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                textDecoration: 'none'
              }}
            >
              <span>비즈박스 열기</span>
              <ExternalLink size={13} />
            </a>
            <button type="button" className="btn-create" onClick={onClose}>
              확인
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
