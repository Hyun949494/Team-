import { useState, useEffect, useMemo } from 'react';
import { format, startOfWeek, endOfWeek, addDays, startOfMonth, endOfMonth, isSameMonth, isSameDay, addMonths, subMonths, parseISO, isWithinInterval } from 'date-fns';
import { ko } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus, Calendar as CalendarIcon, Users } from 'lucide-react';
import { collection, onSnapshot, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from './firebase';
import './App.css';
import './index.css';

// 실제 팀원 목록
const TEAM_MEMBERS = ['김충현', '김두현', '정연철', '조은애', '김수환', '김지훈', '오수민', '이수정', '장은지'];

function App() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [schedules, setSchedules] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedMember, setSelectedMember] = useState('all'); // 필터용
  const [isFirebaseReady, setIsFirebaseReady] = useState(!!db);

  // Firestore 실시간 데이터 구독
  useEffect(() => {
    if (!db) {
      setIsFirebaseReady(false);
      return;
    }

    const unsubscribe = onSnapshot(collection(db, 'schedules'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSchedules(data);
    });

    return () => unsubscribe();
  }, []);

  const handleAddSchedule = async (schedule) => {
    try {
      if (db) {
        await addDoc(collection(db, 'schedules'), schedule);
      } else {
        // 로컬 테스트용 폴백 (저장 안 됨)
        setSchedules(prev => [...prev, { ...schedule, id: Date.now().toString() }]);
      }
      setIsModalOpen(false);
    } catch (error) {
      console.error("Error adding document: ", error);
      alert("앗! 일정 저장에 실패했습니다. (에러: " + error.message + ")");
    }
  };

  const handleDeleteSchedule = async (id) => {
    if (window.confirm('이 일정을 삭제하시겠습니까?')) {
      try {
        if (db) {
          await deleteDoc(doc(db, 'schedules', id));
        } else {
          setSchedules(prev => prev.filter(s => s.id !== id));
        }
      } catch (error) {
        console.error("Error deleting document: ", error);
        alert("앗! 일정 삭제에 실패했습니다. (에러: " + error.message + ")");
      }
    }
  };

  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));

  // 필터링된 일정
  const filteredSchedules = useMemo(() => {
    if (selectedMember === 'all') return schedules;
    return schedules.filter(s => s.name === selectedMember);
  }, [schedules, selectedMember]);

  const renderHeader = () => {
    return (
      <div className="calendar-header">
        <div className="month-display">
          <h2>{format(currentDate, 'yyyy년 M월')}</h2>
        </div>
        <div className="nav-buttons">
          <button onClick={prevMonth} className="icon-btn"><ChevronLeft size={20} /></button>
          <button onClick={() => setCurrentDate(new Date())} className="today-btn">오늘</button>
          <button onClick={nextMonth} className="icon-btn"><ChevronRight size={20} /></button>
        </div>
      </div>
    );
  };

  const renderDays = () => {
    const days = [];
    const date = ['일', '월', '화', '수', '목', '금', '토'];
    for (let i = 0; i < 7; i++) {
      days.push(
        <div className="col col-center" key={i}>
          {date[i]}
        </div>
      );
    }
    return <div className="days row">{days}</div>;
  };

  const renderCells = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);

    const rows = [];
    let days = [];
    let day = startDate;
    let formattedDate = '';

    while (day <= endDate) {
      for (let i = 0; i < 7; i++) {
        formattedDate = format(day, 'd');
        const cloneDay = day;
        const dayOfWeek = i;
        
        // 해당 날짜에 포함되는 일정 필터링
        const daySchedules = filteredSchedules.filter(s => {
          const sStart = parseISO(s.startDate);
          const sEnd = parseISO(s.endDate);
          return isWithinInterval(cloneDay, { start: new Date(sStart.setHours(0,0,0,0)), end: new Date(sEnd.setHours(23,59,59,999)) });
        });

        days.push(
          <div
            className={`col cell ${
              !isSameMonth(day, monthStart)
                ? 'disabled'
                : isSameDay(day, new Date()) ? 'selected' : ''
            }`}
            key={day}
            onClick={() => {
              setSelectedDate(cloneDay);
              setIsModalOpen(true);
            }}
          >
            <div className="number-wrapper">
              <span className="number">{formattedDate}</span>
            </div>
            <div className="schedule-container">
              {daySchedules.map(schedule => {
                const isStart = isSameDay(cloneDay, parseISO(schedule.startDate));
                const isEnd = isSameDay(cloneDay, parseISO(schedule.endDate));
                return (
                  <div 
                    key={schedule.id} 
                    className={`schedule-badge cat-${schedule.category} ${isStart ? 'is-start' : ''} ${isEnd ? 'is-end' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSchedule(schedule.id);
                    }}
                    title={`${schedule.name} - ${getCategoryLabel(schedule.category)}`}
                  >
                    <span className="name">{schedule.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
        day = addDays(day, 1);
      }
      rows.push(
        <div className="row" key={day}>
          {days}
        </div>
      );
      days = [];
    }
    return <div className="body">{rows}</div>;
  };

  return (
    <div className="app-container">
      
      <header className="app-header glass-panel">
        <div className="logo">
          <CalendarIcon size={24} />
          <h1>Team Schedule</h1>
        </div>
        <div className="header-actions">
          <select 
            className="filter-select" 
            value={selectedMember} 
            onChange={e => setSelectedMember(e.target.value)}
          >
            <option value="all">전체 팀원 보기</option>
            {TEAM_MEMBERS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <button 
            className="btn-primary"
            onClick={() => {
              setSelectedDate(new Date());
              setIsModalOpen(true);
            }}
          >
            <Plus size={18} />
            일정 추가
          </button>
        </div>
      </header>

      <main className="main-content">
        <div className="calendar-wrapper glass-panel">
          {renderHeader()}
          {renderDays()}
          {renderCells()}
        </div>

        <aside className="dashboard-wrapper glass-panel">
          <div className="dashboard-header">
            <Users size={20} />
            <h3>다가오는 일정</h3>
          </div>
          <div className="dashboard-list">
            {filteredSchedules
              .filter(s => new Date(s.endDate) >= new Date(new Date().setHours(0,0,0,0)))
              .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
              .slice(0, 5)
              .map(schedule => (
                <div key={schedule.id} className="dashboard-item">
                  <div className="date">
                    {format(parseISO(schedule.startDate), 'M월 d일', { locale: ko })} 
                    {schedule.startDate !== schedule.endDate && ` ~ ${format(parseISO(schedule.endDate), 'M월 d일', { locale: ko })}`}
                  </div>
                  <div className="info">
                    <strong>{schedule.name}</strong> - {getCategoryLabel(schedule.category)}
                  </div>
                  {schedule.memo && <div className="memo">{schedule.memo}</div>}
                </div>
              ))}
            {filteredSchedules.length === 0 && (
              <p className="empty-msg">예정된 일정이 없습니다.</p>
            )}
          </div>
        </aside>
      </main>

      {isModalOpen && (
        <ScheduleModal 
          onClose={() => setIsModalOpen(false)}
          onSave={handleAddSchedule}
          selectedDate={selectedDate}
        />
      )}
    </div>
  );
}

const getCategoryLabel = (cat) => {
  const map = {
    vacation: '휴가',
    outside: '외근',
    meeting: '미팅',
    other: '기타'
  };
  return map[cat] || cat;
};

function ScheduleModal({ onClose, onSave, selectedDate }) {
  const [name, setName] = useState(TEAM_MEMBERS[0]);
  const [category, setCategory] = useState('vacation');
  const [startDate, setStartDate] = useState(format(selectedDate || new Date(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(selectedDate || new Date(), 'yyyy-MM-dd'));
  const [memo, setMemo] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (new Date(startDate) > new Date(endDate)) {
      alert('종료일은 시작일보다 빠를 수 없습니다.');
      return;
    }
    onSave({ name, category, startDate, endDate, memo });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content glass-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>일정 등록</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="modal-form">
          <div className="date-range">
            <div className="form-group">
              <label>시작일</label>
              <input 
                type="date" 
                value={startDate} 
                onChange={e => {
                  setStartDate(e.target.value);
                  if (new Date(e.target.value) > new Date(endDate)) {
                    setEndDate(e.target.value);
                  }
                }}
                required
              />
            </div>
            <span>~</span>
            <div className="form-group">
              <label>종료일</label>
              <input 
                type="date" 
                value={endDate} 
                onChange={e => setEndDate(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="form-group">
            <label>팀원 선택</label>
            <select value={name} onChange={e => setName(e.target.value)}>
              {TEAM_MEMBERS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>분류</label>
            <select value={category} onChange={e => setCategory(e.target.value)}>
              <option value="vacation">휴가</option>
              <option value="outside">외근</option>
              <option value="meeting">미팅</option>
              <option value="other">기타</option>
            </select>
          </div>
          <div className="form-group">
            <label>메모 (선택)</label>
            <input 
              type="text" 
              placeholder="예: 제주도 가족여행"
              value={memo}
              onChange={e => setMemo(e.target.value)}
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>취소</button>
            <button type="submit" className="btn-primary">저장하기</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default App;
