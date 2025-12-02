import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, X, List, Calendar, ChevronDown, Save, Send, Loader2, AlertCircle, User, Clock, CheckCircle, FileText, Trash2, Download } from 'lucide-react';
// FIX: 恢復 Firebase 導入路徑，並移除 .js 擴展名，以解決 Rollup 錯誤
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithCustomToken,
  signInAnonymously,
  onAuthStateChanged,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  query,
  where,
  getDocs,
  writeBatch,
} from 'firebase/firestore';

// --- Firebase Initialization ---
// 確保變數存在
const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Firestore 集合路徑
const PROJECT_COLLECTION_PATH = `artifacts/${appId}/public/data/projects`;
const REPORT_COLLECTION_PATH = `artifacts/${appId}/public/data/project_reports`;
const NOTES_HISTORY_COLLECTION_PATH = `artifacts/${appId}/public/data/notes_history`;

// --- 輔助函數 ---

// 下載 JSON 檔案
const downloadJson = (data, filename) => {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

// 將時間戳記轉換為易讀的日期時間格式
const formatDateTime = (timestamp) => {
  if (!timestamp) return '未定';
  // 處理 Firestore Timestamp 或 JS Date
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

// 將時間戳記轉換為 YYYY-MM-DD 格式，適用於日期輸入欄位
const formatDateToInput = (timestamp) => {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  // 安全性檢查
  if (isNaN(date.getTime())) return ''; 
  return date.toISOString().split('T')[0];
};

// 格式化時間範圍
const formatTimeRange = (start, end) => {
  const startStr = start ? formatDateToInput(start) : '未定';
  const endStr = end ? formatDateToInput(end) : '未定';
  if (startStr === '未定' && endStr === '未定') return '尚未排程';
  return `${startStr} ~ ${endStr}`;
};

// 計算距離上次更新的天數
const formatDaysAgo = (timestamp) => {
  if (!timestamp) return '無紀錄';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const diffTime = Math.abs(new Date() - date);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  return `${diffDays} 天前`;
};

// 計算專案狀態 (核心邏輯)
const calculateStatus = (project) => {
  const plannedEnd = project.plannedEnd ? project.plannedEnd.toDate() : null;
  const now = new Date();
  
  if (project.isClosed) {
    return { status: 'CLOSED', color: 'gray', label: '✅ 已結案' };
  }

  if (!plannedEnd) {
    return { status: 'SCHEDULE_NEEDED', color: 'blue', label: '📝 待排程' };
  }
  
  const diffDays = Math.ceil((plannedEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { status: 'OVERDUE', color: 'red', label: `🔴 已逾期 ${Math.abs(diffDays)} 天` };
  } else if (diffDays <= 1) { // 截止日當天和前一天
    return { status: 'DUE_SOON', color: 'yellow', label: `⚠️ 即將到期` };
  } else {
    return { status: 'ON_TRACK', color: 'green', label: '🟢 進行中' };
  }
};

// 專案初始數據 (僅在數據庫為空時使用)
const SEED_PROJECTS = [
  // 為了簡潔，這裡只放一筆模擬數據
  {
    projectCode: 'LTC-鉅盛住宅-10807',
    name: '鉅盛住宅 (新水)',
    responsiblePerson: '王小明',
    lastUpdateDate: serverTimestamp(),
    isClosed: false,
    
    // 前期計畫 (已完成)
    previousActivity: '基礎結構完成與外牆施作',
    previousStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), 
    previousEnd: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
    previousNotes: '前期基礎打樁遇到地質較軟，已追加灌漿。',
    previousRemark: '結構體已完成，驗收通過。',

    // 本期計畫 (正在進行)
    plannedActivity: '進行內部管線配置及防水工程',
    plannedStart: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), 
    plannedEnd: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000), // 明天截止 (即將到期)
    plannedNotes: '水電材料已進場，請確認數量。',
    
    // 下期計畫 (預先排程)
    nextActivity: '室內裝修泥作及磁磚鋪設',
    nextStart: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    nextEnd: new Date(Date.now() + 16 * 24 * 60 * 60 * 1000),
    nextNotes: '請提前與材料商確認磁磚樣式。',
  },
];


// --- 審計歷史查詢組件 (用於動態回報和備註歷史) ---
const useAuditData = (collectionPath, projectId) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId || !auth.currentUser) {
        setLoading(false);
        return;
    }
    
    setLoading(true);
    
    const collectionRef = collection(db, collectionPath);
    // FIX: 移除 orderBy，只用 where 進行篩選，以避免索引錯誤
    const q = query(collectionRef, where('projectId', '==', projectId));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loadedData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // 客戶端排序: 確保最新的在最上面 (timestamp 是 audit 歷史的欄位)
      loadedData.sort((a, b) => {
        const timeA = a.timestamp?.toMillis() || a.createdAt?.toMillis() || 0;
        const timeB = b.timestamp?.toMillis() || b.createdAt?.toMillis() || 0;
        return timeB - timeA;
      });
      
      setData(loadedData);
      setLoading(false);
    }, (err) => {
        console.error(`Error fetching data from ${collectionPath}:`, err);
        setLoading(false);
    });

    return () => unsubscribe();
  }, [projectId, collectionPath, auth.currentUser]);

  return { data, loading };
};


// --- 編輯器組件：小叮嚀 (NoteEditor) ---
const NoteEditor = ({ projectId, currentNote, noteKey, label, user }) => {
  const [note, setNote] = useState(currentNote || '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setNote(currentNote || '');
  }, [currentNote]);

  const handleSubmit = async () => {
    if (note === currentNote) return; // 沒有變動，不儲存

    setIsSaving(true);
    setError(null);
    try {
      const projectRef = doc(db, PROJECT_COLLECTION_PATH, projectId);
      
      // 1. 更新專案主文件
      await updateDoc(projectRef, {
        [noteKey]: note,
      });

      // 2. 寫入歷史紀錄
      await addDoc(collection(db, NOTES_HISTORY_COLLECTION_PATH), {
        projectId: projectId,
        type: 'NOTE', // 小叮嚀
        field: noteKey,
        oldValue: currentNote,
        newValue: note,
        editorId: user.uid,
        editorName: user.displayName || '匿名操作者',
        timestamp: serverTimestamp(),
      });
      
    } catch (err) {
      console.error(`提交 ${label} 錯誤:`, err);
      setError(`提交失敗: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-2 p-3 bg-white rounded-lg border border-indigo-100 shadow-inner">
      <label className="text-xs font-semibold text-indigo-700 block">{label}</label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="在此輸入現場操作者小叮嚀..."
        rows="2"
        className="w-full text-sm p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
      />
      <div className="flex justify-end items-center space-x-2">
        {error && <span className="text-xs text-red-500">{error}</span>}
        <button
          onClick={handleSubmit}
          disabled={isSaving || note === currentNote}
          className={`px-3 py-1 text-sm rounded-md transition-colors flex items-center ${
            note === currentNote
              ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
              : 'bg-indigo-600 text-white hover:bg-indigo-700'
          }`}
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Send className="w-4 h-4 mr-1" />}
          📣 提交小叮嚀
        </button>
      </div>
    </div>
  );
};


// --- 編輯器組件：前期完工備註 (RemarkEditor) ---
const RemarkEditor = ({ projectId, currentRemark, remarkKey, label, user }) => {
  const [remark, setRemark] = useState(currentRemark || '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setRemark(currentRemark || '');
  }, [currentRemark]);

  const handleSubmit = async () => {
    if (remark === currentRemark) return;

    setIsSaving(true);
    setError(null);
    try {
      const projectRef = doc(db, PROJECT_COLLECTION_PATH, projectId);
      
      // 1. 更新專案主文件
      await updateDoc(projectRef, {
        [remarkKey]: remark,
      });

      // 2. 寫入歷史紀錄
      await addDoc(collection(db, NOTES_HISTORY_COLLECTION_PATH), {
        projectId: projectId,
        type: 'REMARK', // 完工備註
        field: remarkKey,
        oldValue: currentRemark,
        newValue: remark,
        editorId: user.uid,
        editorName: user.displayName || '匿名負責人',
        timestamp: serverTimestamp(),
      });

    } catch (err) {
      console.error(`提交 ${label} 錯誤:`, err);
      setError(`提交失敗: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-2 p-3 bg-white rounded-lg border border-green-100 shadow-inner">
      <label className="text-xs font-semibold text-green-700 block">{label}</label>
      <textarea
        value={remark}
        onChange={(e) => setRemark(e.target.value)}
        placeholder="在此輸入前期完工備註..."
        rows="2"
        className="w-full text-sm p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
      />
      <div className="flex justify-end items-center space-x-2">
        {error && <span className="text-xs text-red-500">{error}</span>}
        <button
          onClick={handleSubmit}
          disabled={isSaving || remark === currentRemark}
          className={`px-3 py-1 text-sm rounded-md transition-colors flex items-center ${
            remark === currentRemark
              ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
              : 'bg-green-600 text-white hover:bg-green-700'
          }`}
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
          💾 儲存備註
        </button>
      </div>
    </div>
  );
};

// --- 現場動態回報區塊 (ProjectReportSection) ---
const ProjectReportSection = ({ projectId, user }) => {
  const [reportText, setReportText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const { data: reports, loading } = useAuditData(REPORT_COLLECTION_PATH, projectId);

  const handleSendReport = async () => {
    if (!reportText.trim() || !user) return;
    
    setIsSending(true);
    try {
      await addDoc(collection(db, REPORT_COLLECTION_PATH), {
        projectId: projectId,
        report: reportText.trim(),
        reporterId: user.uid,
        reporterName: user.displayName || '匿名回報者',
        timestamp: serverTimestamp(),
      });
      setReportText('');
    } catch (err) {
      console.error('發送回報失敗:', err);
      // 使用 Toast/Modal 代替 alert
      alert('發送回報失敗，請檢查網路。'); 
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="mt-6">
      <h3 className="text-lg font-bold text-gray-800 border-b pb-2 mb-4">📢 現場動態回報</h3>
      
      <div className="flex flex-col space-y-2 mb-4">
        <textarea
          value={reportText}
          onChange={(e) => setReportText(e.target.value)}
          placeholder="輸入即時現場狀況或問題回報..."
          rows="3"
          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm"
          disabled={isSending}
        />
        <button
          onClick={handleSendReport}
          disabled={!reportText.trim() || isSending}
          className="w-full px-4 py-2 bg-pink-600 text-white font-semibold rounded-lg hover:bg-pink-700 disabled:opacity-50 transition-colors flex items-center justify-center"
        >
          {isSending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
          發布動態回報
        </button>
      </div>
      
      <h4 className="font-semibold text-sm text-gray-600 mb-2">回報歷史 ({reports.length})</h4>
      <div className="max-h-60 overflow-y-auto space-y-3 p-3 bg-gray-50 rounded-lg border">
        {loading ? (
          <p className="text-center text-gray-500"><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />載入中...</p>
        ) : reports.length === 0 ? (
          <p className="text-center text-gray-400 text-sm">暫無回報紀錄。</p>
        ) : (
          reports.map((report) => (
            <div key={report.id} className="p-3 bg-white rounded-md shadow-sm border border-gray-200">
              <p className="text-xs text-gray-400 mb-1">
                操作者 ID: {report.reporterId.slice(0, 8)}... - {formatDateTime(report.timestamp)}
              </p>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{report.report}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
};


// --- 審計歷史模態框 (HistoryAuditModal) ---
const HistoryAuditModal = ({ isOpen, onClose, projectId, projectName }) => {
  const { data: reports, loading: reportsLoading } = useAuditData(REPORT_COLLECTION_PATH, projectId);
  const { data: notes, loading: notesLoading } = useAuditData(NOTES_HISTORY_COLLECTION_PATH, projectId);
  
  if (!isOpen) return null;

  const allHistory = useMemo(() => {
    return [...reports.map(r => ({...r, type: 'REPORT', timestamp: r.timestamp})), 
            ...notes.map(n => ({...n, type: 'AUDIT', timestamp: n.timestamp}))]
             .sort((a, b) => (b.timestamp?.toMillis() || 0) - (a.timestamp?.toMillis() || 0));
  }, [reports, notes]);


  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto transform transition-all duration-300">
        <div className="sticky top-0 bg-white p-6 border-b flex justify-between items-center z-10">
          <h2 className="text-xl font-bold text-gray-800 flex items-center">
            📜 {projectName} - 完整歷史審計
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800 p-2 rounded-full hover:bg-gray-100 transition-colors">
            <X size={24} />
          </button>
        </div>
        
        <div className="p-6 space-y-6">
          <h3 className="text-lg font-bold text-gray-800 border-b pb-2">所有操作記錄 ({allHistory.length})</h3>
          
          {(reportsLoading || notesLoading) ? (
            <p className="text-center text-gray-500 py-10"><Loader2 className="w-6 h-6 inline mr-2 animate-spin" />正在載入所有歷史數據...</p>
          ) : allHistory.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-10 border border-dashed rounded-lg">此專案暫無任何操作或回報歷史紀錄。</p>
          ) : (
            <div className="space-y-4">
              {allHistory.map((item) => (
                <div key={item.id} className={`p-4 rounded-lg shadow-sm border ${item.type === 'REPORT' ? 'bg-pink-50 border-pink-200' : 'bg-blue-50 border-blue-200'}`}>
                  <div className="flex justify-between items-start mb-2 border-b pb-1">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${item.type === 'REPORT' ? 'bg-pink-500 text-white' : 'bg-blue-500 text-white'}`}>
                      {item.type === 'REPORT' ? '現場回報' : '備註/計畫變更'}
                    </span>
                    <span className="text-xs text-gray-500">
                      {formatDateTime(item.timestamp)}
                    </span>
                  </div>
                  
                  {item.type === 'REPORT' ? (
                    <>
                      <p className="text-sm font-medium text-gray-700 whitespace-pre-wrap">{item.report}</p>
                      <p className="text-xs mt-1 text-gray-500">回報者 ID: {item.reporterId.slice(0, 8)}...</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-gray-700">欄位: <span className="font-mono bg-gray-100 px-1 rounded text-xs">{item.field}</span></p>
                      {item.oldValue !== undefined && <p className="text-xs text-gray-600 mt-1">舊值: {item.oldValue || '(空)'}</p>}
                      <p className="text-xs text-gray-600">新值: {item.newValue || '(空)'}</p>
                      <p className="text-xs mt-1 text-gray-500">編輯者 ID: {item.editorId.slice(0, 8)}...</p>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// --- 新增專案模態框 (AddProjectModal) ---
const AddProjectModal = ({ isOpen, onClose, user }) => {
  // FIX: 使用 new Date() 初始化客戶端日期，避免 RangeError: Invalid time value
  const initialDate = formatDateToInput(new Date()); 
  const [draft, setDraft] = useState({
    projectCode: '',
    name: '',
    responsiblePerson: '',
    plannedActivity: '',
    plannedStart: initialDate,
    plannedEnd: initialDate,
  });
  const [isAdding, setIsAdding] = useState(false);

  if (!isOpen) return null;

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setDraft(prev => ({ ...prev, [name]: value }));
  };

  const handleAddProject = async () => {
    if (!draft.name || !draft.responsiblePerson || !draft.plannedActivity) return;
    
    setIsAdding(true);
    try {
      await addDoc(collection(db, PROJECT_COLLECTION_PATH), {
        ...draft,
        lastUpdateDate: serverTimestamp(),
        isClosed: false,
        plannedStart: new Date(draft.plannedStart),
        plannedEnd: new Date(draft.plannedEnd),
        // 清空其他非必要的初始欄位
        previousActivity: '',
        previousStart: null,
        previousEnd: null,
        previousNotes: '',
        previousRemark: '',
        nextActivity: '',
        nextStart: null,
        nextEnd: null,
        nextNotes: '',
      });
      onClose();
    } catch (err) {
      console.error('新增專案失敗:', err);
      alert('新增專案失敗，請檢查輸入內容。'); // 使用 Toast/Modal 代替 alert
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg transform transition-all duration-300">
        <div className="p-6 border-b flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-800">➕ 新增專案</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800 p-2 rounded-full hover:bg-gray-100 transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <input name="projectCode" type="text" placeholder="工程編號 (選填)" value={draft.projectCode} onChange={handleInputChange} className="w-full p-3 border border-gray-300 rounded-lg" />
          <input name="name" type="text" placeholder="* 專案名稱 (必填)" value={draft.name} onChange={handleInputChange} className="w-full p-3 border border-gray-300 rounded-lg" required />
          <input name="responsiblePerson" type="text" placeholder="* 負責人 (必填)" value={draft.responsiblePerson} onChange={handleInputChange} className="w-full p-3 border border-gray-300 rounded-lg" required />
          
          <div className="pt-4 border-t">
            <h3 className="font-semibold text-gray-700 mb-2">初始本期計畫 (必填)</h3>
            <textarea name="plannedActivity" placeholder="* 本期計畫活動內容" value={draft.plannedActivity} onChange={handleInputChange} rows="2" className="w-full p-3 border border-gray-300 rounded-lg text-sm" required />
            <div className="flex space-x-2">
              <input name="plannedStart" type="date" value={draft.plannedStart} onChange={handleInputChange} className="w-1/2 p-3 border border-gray-300 rounded-lg" />
              <input name="plannedEnd" type="date" value={draft.plannedEnd} onChange={handleInputChange} className="w-1/2 p-3 border border-gray-300 rounded-lg" required />
            </div>
          </div>
        </div>
        <div className="p-6 border-t flex justify-end">
          <button
            onClick={handleAddProject}
            disabled={isAdding || !draft.name || !draft.responsiblePerson || !draft.plannedActivity}
            className="px-6 py-2 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center"
          >
            {isAdding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-5 h-5 mr-2" />}
            新增專案
          </button>
        </div>
      </div>
    </div>
  );
};


// --- 專案詳情與週期轉換模態框 (ProjectDetailModal) ---
const ProjectDetailModal = ({ isOpen, onClose, project, user, onUpdateProject }) => {
  const [draft, setDraft] = useState({
    plannedActivity: project?.nextActivity || '',
    plannedStart: formatDateToInput(project?.nextStart || new Date()), // 使用新的nextStart或當前日期
    plannedEnd: formatDateToInput(project?.nextEnd || new Date()),
    nextActivity: '',
    nextStart: '',
    nextEnd: '',
  });
  const [isUpdating, setIsUpdating] = useState(false);
  
  // 確保在 project 變化時，draft 狀態被重置
  useEffect(() => {
    if (project) {
        setDraft({
            plannedActivity: project.nextActivity || '',
            plannedStart: formatDateToInput(project.nextStart || new Date()), // 重置時確保日期有效
            plannedEnd: formatDateToInput(project.nextEnd || new Date()),
            nextActivity: '',
            nextStart: '',
            nextEnd: '',
        });
    }
  }, [project]);
  
  if (!isOpen || !project) return null;

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setDraft(prev => ({ ...prev, [name]: value }));
  };

  const handleScheduledUpdate = async () => {
    if (!draft.plannedActivity || !draft.plannedEnd) {
      alert('新的本期計畫內容與截止日為必填項！'); // 使用 Toast/Modal 代替 alert
      return;
    }

    setIsUpdating(true);
    try {
      const updateData = {
        // 1. 本期 -> 前期 (歸檔)
        previousActivity: project.plannedActivity,
        previousStart: project.plannedStart,
        previousEnd: project.plannedEnd,
        previousNotes: project.plannedNotes, // 將舊本期的小叮嚀一起歸檔

        // 2. 新的本期計畫 (來自使用者輸入的 nextActivity/Start/End)
        plannedActivity: draft.plannedActivity,
        plannedStart: new Date(draft.plannedStart),
        plannedEnd: new Date(draft.plannedEnd),
        plannedNotes: project.nextNotes || '', // 繼承舊的下期小叮嚀，作為新本期的初始小叮嚀
        
        // 3. 新的下期計畫 (來自使用者輸入的新 nextActivity/Start/End)
        nextActivity: draft.nextActivity || '',
        nextStart: draft.nextStart ? new Date(draft.nextStart) : null,
        nextEnd: draft.nextEnd ? new Date(draft.nextEnd) : null,
        nextNotes: '', // 清空下期小叮嚀，等待操作者填寫

        // 4. 更新管制日期
        lastUpdateDate: serverTimestamp(),
      };

      await onUpdateProject(project.id, updateData);
      onClose();
    } catch (err) {
      console.error('週期轉換失敗:', err);
      alert('週期轉換失敗，請重試。'); // 使用 Toast/Modal 代替 alert
    } finally {
      setIsUpdating(false);
    }
  };


  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto transform transition-all duration-300">
        <div className="sticky top-0 bg-white p-6 border-b flex justify-between items-center z-10">
          <h2 className="text-xl font-bold text-gray-800">
            {project.name} - 週期轉換與回報
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800 p-2 rounded-full hover:bg-gray-100 transition-colors">
            <X size={24} />
          </button>
        </div>
        
        <div className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            
            {/* 左側：週期轉換與計畫排程 */}
            <div className="space-y-6">
              <h3 className="text-lg font-bold text-gray-800 border-b pb-2">🔄 週期轉換與排程</h3>

              {/* 現有狀態總覽 */}
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg space-y-1">
                <p className="font-semibold text-sm text-yellow-800">當前計畫狀態</p>
                <p className="text-xs text-gray-600">本期活動: {project.plannedActivity}</p>
                <p className="text-xs text-gray-600">截止日期: <span className="font-bold text-red-600">{formatDateToInput(project.plannedEnd)}</span></p>
                <p className="text-xs text-gray-600">上次更新: {formatDateTime(project.lastUpdateDate)}</p>
              </div>

              {/* 新本期計畫輸入區 */}
              <div className="space-y-3 p-4 border border-blue-200 rounded-lg bg-blue-50">
                <h4 className="font-bold text-blue-800 flex items-center"><CheckCircle className="w-5 h-5 mr-2" /> 1. 新本期計畫 (必填)</h4>
                
                <textarea
                  name="plannedActivity"
                  placeholder="* 本期計畫活動內容"
                  value={draft.plannedActivity}
                  onChange={handleInputChange}
                  rows="3"
                  className="w-full p-2 border border-blue-300 rounded-md text-sm"
                  required
                />
                <div className="flex space-x-2">
                  <input name="plannedStart" type="date" value={draft.plannedStart} onChange={handleInputChange} className="w-1/2 p-2 border border-blue-300 rounded-md" />
                  <input name="plannedEnd" type="date" value={draft.plannedEnd} onChange={handleInputChange} className="w-1/2 p-2 border border-blue-300 rounded-md" required />
                </div>
              </div>

              {/* 新下期計畫輸入區 */}
              <div className="space-y-3 p-4 border border-gray-200 rounded-lg bg-gray-50">
                <h4 className="font-bold text-gray-800 flex items-center"><Calendar className="w-5 h-5 mr-2" /> 2. 新下期計畫 (選填)</h4>
                
                <textarea
                  name="nextActivity"
                  placeholder="下期計畫活動內容"
                  value={draft.nextActivity}
                  onChange={handleInputChange}
                  rows="3"
                  className="w-full p-2 border border-gray-300 rounded-md text-sm"
                />
                <div className="flex space-x-2">
                  <input name="nextStart" type="date" value={draft.nextStart} onChange={handleInputChange} className="w-1/2 p-2 border border-gray-300 rounded-md" />
                  <input name="nextEnd" type="date" value={draft.nextEnd} onChange={handleInputChange} className="w-1/2 p-2 border border-gray-300 rounded-md" />
                </div>
              </div>

              {/* 提交按鈕 */}
              <button
                onClick={handleScheduledUpdate}
                disabled={isUpdating || !draft.plannedActivity || !draft.plannedEnd}
                className="w-full px-4 py-3 bg-red-600 text-white font-bold text-lg rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center justify-center shadow-lg"
              >
                {isUpdating ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <List className="w-5 h-5 mr-2" />}
                確認完成本期並提交新週期計畫
              </button>
            </div>


            {/* 右側：現場動態回報與歷史紀錄 */}
            <div className="space-y-6">
              {/* 現場動態回報 */}
              <ProjectReportSection projectId={project.id} user={user} />
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};


// --- 主卡片組件 (ProjectCard) ---
const ProjectCard = ({ project, onOpenDetail, onOpenHistory, onFinalClose, user }) => {
  const { status, color, label } = calculateStatus(project);
  
  const borderClasses = {
    'OVERDUE': 'border-l-red-500 bg-red-50',
    'DUE_SOON': 'border-l-yellow-500 bg-yellow-50',
    'ON_TRACK': 'border-l-green-500 bg-green-50',
    'SCHEDULE_NEEDED': 'border-l-blue-500 bg-blue-50',
    'CLOSED': 'border-l-gray-400 bg-gray-100',
  }[status] || 'border-l-gray-300 bg-white';
  
  // 處理最終結案 (下載並刪除)
  const handleClose = async () => {
    // 使用 Toast/Modal 代替 window.confirm
    if (window.confirm(`確定要永久結案專案 "${project.name}" 嗎？這將下載所有歷史記錄並從數據庫中永久刪除專案及相關數據。`)) {
        await onFinalClose(project);
    }
  };

  return (
    <div className={`flex flex-col p-4 rounded-xl border border-gray-200 shadow-lg transition-all duration-300 ${borderClasses}`}>
      <div className="flex justify-between items-start border-b pb-3 mb-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{project.name}</h2>
          <p className="text-xs text-gray-500">{project.projectCode}</p>
        </div>
        <span className={`text-xs font-semibold px-3 py-1 rounded-full text-white ${
          color === 'red' ? 'bg-red-600' : 
          color === 'yellow' ? 'bg-yellow-600' : 
          color === 'green' ? 'bg-green-600' : 
          'bg-gray-500'
        }`}>
          {label}
        </span>
      </div>

      <div className="text-sm space-y-3 flex-1">
        <p className="text-gray-600">
          <span className="font-semibold text-gray-800">負責人:</span> {project.responsiblePerson}
        </p>
        <p className="text-gray-600">
          <span className="font-semibold text-gray-800">上次更新:</span> {formatDateTime(project.lastUpdateDate)} ({formatDaysAgo(project.lastUpdateDate)})
        </p>
        
        {/* --- 計畫列表 --- */}
        <div className="space-y-4 pt-2 border-t border-gray-100">
          {/* 前期計畫 */}
          <div className="p-2 border border-gray-200 rounded-lg bg-gray-50">
            <h4 className="text-xs font-semibold text-gray-600 mb-1">前期計畫 (已完成)</h4>
            <p className="text-sm font-medium text-gray-700">{project.previousActivity || 'N/A'}</p>
            <p className="text-xs text-gray-500 flex items-center"><Calendar className="w-3 h-3 mr-1"/> {formatTimeRange(project.previousStart, project.previousEnd)}</p>
            {/* 前期完工備註編輯器 */}
            <RemarkEditor
              projectId={project.id}
              currentRemark={project.previousRemark}
              remarkKey="previousRemark"
              label="完工備註 (負責人填寫)"
              user={user}
            />
          </div>

          {/* 本期計畫 */}
          <div className="p-2 border border-blue-200 rounded-lg bg-blue-50">
            <h4 className="text-xs font-semibold text-blue-700 mb-1">本期計畫 (進行中)</h4>
            <p className="text-sm font-medium text-gray-800">{project.plannedActivity || 'N/A'}</p>
            <p className="text-xs text-blue-600 flex items-center"><Calendar className="w-3 h-3 mr-1"/> {formatTimeRange(project.plannedStart, project.plannedEnd)}</p>
            {/* 本期小叮嚀編輯器 */}
            <NoteEditor
              projectId={project.id}
              currentNote={project.plannedNotes}
              noteKey="plannedNotes"
              label="現場操作者小叮嚀"
              user={user}
            />
          </div>

          {/* 下期計畫 */}
          <div className="p-2 border border-green-200 rounded-lg bg-green-50">
            <h4 className="text-xs font-semibold text-green-700 mb-1">下期計畫 (預排)</h4>
            <p className="text-sm font-medium text-gray-800">{project.nextActivity || 'N/A'}</p>
            <p className="text-xs text-green-600 flex items-center"><Calendar className="w-3 h-3 mr-1"/> {formatTimeRange(project.nextStart, project.nextEnd)}</p>
            {/* 下期小叮嚀編輯器 */}
            <NoteEditor
              projectId={project.id}
              currentNote={project.nextNotes}
              noteKey="nextNotes"
              label="預排小叮嚀"
              user={user}
            />
          </div>
        </div>
        
      </div>

      {/* 底部行動按鈕 */}
      <div className="mt-4 pt-3 border-t flex flex-wrap gap-2 justify-end">
        <button
          onClick={() => onOpenHistory(project.id)}
          className="px-3 py-1.5 text-xs bg-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-300 transition-colors flex items-center"
        >
          📜 歷史記錄
        </button>
        <button
          onClick={handleClose}
          className="px-3 py-1.5 text-xs bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-colors flex items-center"
        >
          ❌ 結案
        </button>
        <button
          onClick={() => onOpenDetail(project)}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors flex items-center"
        >
          🔄 週期轉換
        </button>
      </div>
    </div>
  );
};


// --- 主應用程式 (ProjectTrackerApp) ---
function ProjectTrackerApp() {
  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedProjectIdForHistory, setSelectedProjectIdForHistory] = useState(null);
  const [sortKey, setSortKey] = useState('lastUpdateDate');
  const [sortOrder, setSortOrder] = useState('desc');
  const [isClosingProject, setIsClosingProject] = useState(false); // 新增狀態

  // 1. 認證與用戶資訊獲取
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (initialAuthToken) {
          await signInWithCustomToken(auth, initialAuthToken);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth error:", err);
        setError("認證失敗: " + (err.message || "未知錯誤"));
      } finally {
        setAuthLoading(false);
      }
    };

    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setError(null);
      }
    });
    return () => unsubscribe();
  }, []);

  // 2. 數據獲取與初始化
  useEffect(() => {
    if (!user) return;

    setLoading(true);
    setError(null);

    const projectCollectionRef = collection(db, PROJECT_COLLECTION_PATH);
    
    // 專注於過濾活躍項目
    const q = query(projectCollectionRef, where('isClosed', '==', false));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const loadedProjects = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        
        // 如果數據庫為空，寫入初始數據 (僅非匿名用戶)
        if (loadedProjects.length === 0 && user && !user.isAnonymous) {
          SEED_PROJECTS.forEach(async (project) => {
            await addDoc(projectCollectionRef, project);
          });
        }
        
        // 客戶端排序：避免 Firestore 複合索引錯誤
        const sortedProjects = loadedProjects.sort((a, b) => {
          const timeA = a[sortKey]?.toMillis() || 0;
          const timeB = b[sortKey]?.toMillis() || 0;
          return sortOrder === 'asc' ? timeA - timeB : timeB - timeA;
        });

        setProjects(sortedProjects);
        setLoading(false);
      },
      (err) => {
        console.error("Firestore 數據載入錯誤:", err);
        setError("數據載入失敗：" + err.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user, sortKey, sortOrder]);


  // 3. 數據更新處理
  const handleUpdateProject = useCallback(async (projectId, data) => {
    try {
      await updateDoc(doc(db, PROJECT_COLLECTION_PATH, projectId), data);
    } catch (err) {
      console.error("更新專案失敗:", err);
      setError("更新失敗: " + err.message);
    }
  }, []);

  // 4. 最終結案邏輯 (下載歷史紀錄並刪除)
  const handleFinalClose = useCallback(async (project) => {
    setIsClosingProject(true);
    try {
      const projectId = project.id;

      // a. 獲取所有歷史數據
      const reportsQuery = query(collection(db, REPORT_COLLECTION_PATH), where('projectId', '==', projectId));
      const notesQuery = query(collection(db, NOTES_HISTORY_COLLECTION_PATH), where('projectId', '==', projectId));
      
      const [reportsSnap, notesSnap] = await Promise.all([getDocs(reportsQuery), getDocs(notesQuery)]);

      const reports = reportsSnap.docs.map(doc => doc.data());
      const notes = notesSnap.docs.map(doc => doc.data());

      const archiveData = {
          projectDetails: project,
          reportsHistory: reports,
          notesHistory: notes,
      };

      // b. 觸發下載 JSON
      downloadJson(archiveData, `Archive_${project.name}_${projectId.slice(0, 5)}.json`);
      
      // c. 永久刪除數據
      const batch = writeBatch(db);

      // 刪除主文件
      batch.delete(doc(db, PROJECT_COLLECTION_PATH, projectId));

      // 刪除所有回報歷史
      reportsSnap.docs.forEach(d => batch.delete(d.ref));

      // 刪除所有備註歷史
      notesSnap.docs.forEach(d => batch.delete(d.ref));
      
      await batch.commit();

      setError(`專案 "${project.name}" 已成功封存並永久刪除。`);
    } catch (err) {
      console.error("最終結案失敗:", err);
      setError(`最終結案失敗！請手動檢查：${err.message}`);
    } finally {
      setIsClosingProject(false);
    }
  }, []);
  
  const handleSort = (key) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('desc');
    }
  };


  // 渲染區塊
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 font-sans text-gray-800">
      {isClosingProject && (
          <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center p-4 z-50">
              <div className="p-8 bg-white rounded-lg flex flex-col items-center shadow-2xl">
                  <Loader2 className="w-8 h-8 text-red-600 animate-spin mb-4" />
                  <p className="text-lg font-semibold text-gray-700">正在封存並刪除專案...</p>
                  <p className="text-sm text-gray-500 mt-1">請勿關閉視窗，檔案下載將在完成後自動開始。</p>
              </div>
          </div>
      )}
      
      <div className="max-w-7xl mx-auto">
        
        {/* Header and Controls */}
        <header className="bg-white p-4 rounded-xl shadow-lg mb-6 sticky top-4 z-20">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b pb-3 mb-3">
            <h1 className="text-2xl font-extrabold text-blue-800 flex items-center">
              <List className="w-6 h-6 mr-2" /> 在建工程進度管制台
            </h1>
            <div className="flex items-center space-x-3 mt-3 sm:mt-0">
                {user && (
                    <div className="flex items-center gap-2 bg-gray-100 px-3 py-1.5 rounded-full">
                      <User size={14} className="text-gray-500"/>
                      <span className="text-xs text-gray-600 font-mono">
                        操作者 ID: {user.uid.slice(0, 8)}...
                      </span>
                    </div>
                )}
                <button
                  onClick={() => setIsAddModalOpen(true)}
                  className="px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-colors flex items-center shadow-md"
                >
                  <Plus className="w-5 h-5 mr-1" /> 新增專案
                </button>
            </div>
          </div>
          
          {/* 排序控制 */}
          <div className="flex items-center text-sm text-gray-600">
            <span className="mr-2">排序依據:</span>
            {[{key: 'lastUpdateDate', label: '上次更新'}, {key: 'plannedEnd', label: '截止日期'}]
              .map(({key, label}) => (
                <button 
                  key={key}
                  onClick={() => handleSort(key)}
                  className={`px-3 py-1 rounded-full text-xs transition-colors flex items-center ${sortKey === key ? 'bg-blue-100 text-blue-700 font-bold' : 'hover:bg-gray-100'}`}
                >
                  {label}
                  {sortKey === key && <ChevronDown className={`w-3 h-3 ml-1 transition-transform ${sortOrder === 'asc' ? 'rotate-180' : ''}`} />}
                </button>
            ))}
          </div>
        </header>

        {/* Error Display */}
        {error && (
          <div className="bg-red-100 p-4 border-l-4 border-red-500 flex items-start gap-3 rounded-lg mb-6 shadow">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-700">{error}</div> 
          </div>
        )}

        {/* Main Content */}
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-20 text-gray-400 border-4 border-dashed border-gray-200 rounded-xl max-w-lg mx-auto bg-white shadow">
            <p className="text-xl font-semibold mb-2">目前沒有活躍的工程項目</p>
            <p>請點擊右上角的「+ 新增專案」按鈕開始管理。</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpenDetail={setSelectedProject}
                onOpenHistory={setSelectedProjectIdForHistory}
                onFinalClose={handleFinalClose}
                user={user}
              />
            ))}
          </div>
        )}
      </div>

      {/* 模態框渲染 */}
      <AddProjectModal 
        isOpen={isAddModalOpen} 
        onClose={() => setIsAddModalOpen(false)} 
        user={user}
      />

      <ProjectDetailModal 
        isOpen={!!selectedProject} 
        onClose={() => setSelectedProject(null)} 
        project={selectedProject}
        user={user}
        onUpdateProject={handleUpdateProject}
      />
      
      <HistoryAuditModal
        isOpen={!!selectedProjectIdForHistory}
        onClose={() => setSelectedProjectIdForHistory(null)}
        projectId={selectedProjectIdForHistory}
        projectName={projects.find(p => p.id === selectedProjectIdForHistory)?.name || ''}
      />
    </div>
  );
}

// 導出主組件並包裝在 ErrorBoundary 中
export default function App() {
    return (
        <ErrorBoundary>
            <ProjectTrackerApp />
        </ErrorBoundary>
    );
}

// --- 錯誤邊界組件 (新增) ---
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Uncaught error in component:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 bg-red-100 border border-red-400 rounded-lg max-w-2xl mx-auto mt-10">
          <h2 className="text-xl font-bold text-red-700 flex items-center">
            <AlertCircle className="w-6 h-6 mr-2" /> 應用程式渲染錯誤
          </h2>
          <p className="mt-4 text-sm text-red-600">由於程式碼運行錯誤，畫面無法顯示。請嘗試重新生成程式碼。</p>
          <pre className="mt-4 p-3 bg-red-50 text-xs overflow-x-auto rounded">
            {this.state.error && this.state.error.toString()}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}