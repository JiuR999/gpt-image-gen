import { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Settings, Image as ImageIcon, Loader2, Trash2, 
  CheckCircle2, AlertCircle, Upload, X, Play, Clock, Server, Sparkles, History, Download, Wallet, RefreshCw, User,
  ChevronLeft, Info, Braces
} from 'lucide-react';

const API_BASE = '/pearapi';
const MODELS_API_URL = `${API_BASE}/system/auth/models/all?type=image`;
const DEFAULT_SIZES = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4'];
const FALLBACK_MODELS = ['gpt-image-2', 'grok-4-image', 'midjourney-v6', 'dall-e-3'].map(id => ({
  model_id: id,
  model_name: id,
  billing_type: 'count',
}));

// 辅助函数：从本地存储获取数据
const getStoredItem = (key, defaultValue) => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch {
    return defaultValue;
  }
};

// 辅助函数：保存数据到本地存储
const setStoredItem = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    console.error('Failed to save to localStorage');
  }
};

// 辅助函数：读取缓存的模型列表（无缓存时用兜底列表）
const loadCachedModels = () => {
  const cached = getStoredItem('pear_api_models', []);
  return Array.isArray(cached) && cached.length > 0 ? cached : FALLBACK_MODELS;
};

// 辅助函数：兼容多语言字段（对象取 zh，字符串直接返回）
const i18nText = (value) => (typeof value === 'string' ? value : value?.zh || '');

// 辅助函数：解析模型支持的尺寸比例字符串（如 "9:16、16:9、auto"）
const parseAspectRatios = (str) => (typeof str === 'string' ? str.match(/\d+:\d+|auto/g) || [] : []);

// 辅助函数：生成模型单价短文案（用于下拉/列表行内展示）
const formatPriceShort = (model) => {
  if (!model) return '';
  const summary = i18nText(model.billing_summary);
  if (model.billing_type === 'token') {
    if (model.input_price != null && model.output_price != null) {
      return `¥${model.input_price}/${model.output_price} 每百万tokens`;
    }
    return summary;
  }
  if (model.price != null) {
    return model.billing_type === 'duration' ? `¥${model.price} 起` : `¥${model.price}/次`;
  }
  return summary;
};

// 辅助函数：读取渠道显示名（优先中文，其次原文）
const channelLabel = (model) => {
  const text = i18nText(model?.channel_type_i18n);
  return text || (typeof model?.channel_type === 'string' ? model.channel_type : '');
};

// 辅助函数：判断是否为"默认"渠道
const isDefaultChannel = (model) => {
  const label = channelLabel(model);
  return label === '默认' || model?.channel_type_i18n?.en === 'Default';
};

// 辅助函数：为指定模型挑选默认渠道变体（优先"默认"渠道，否则取第一个）
const pickDefaultVariant = (variants) =>
  variants.find(v => isDefaultChannel(v)) || variants[0] || null;

// 辅助函数：按 model_id 分组（保持首次出现顺序），用于列表去重
const groupModelsByModelId = (models) => {
  const map = new Map();
  models.forEach(m => {
    if (!map.has(m.model_id)) map.set(m.model_id, []);
    map.get(m.model_id).push(m);
  });
  return Array.from(map.values());
};

// 辅助函数：生成模型列表行的价格文案（多渠道取最低价并加"起"字）
const formatPriceForList = (variants) => {
  if (!variants || variants.length === 0) return '';
  if (variants.length === 1) return formatPriceShort(variants[0]);
  const prices = variants.map(v => v.price).filter(p => p != null);
  if (prices.length === 0) return formatPriceShort(variants[0]);
  return `¥${Math.min(...prices)} 起`;
};

// 辅助函数：判断任务状态类别（成功/失败/其他）
const getStatusKind = (statusText) => {
  const text = String(statusText || '');
  if (['成功', '成功(Success)', 'completed', 'success'].includes(text)) return 'success';
  if (['失败', 'failed', 'error'].includes(text)) return 'failed';
  return 'other';
};

// 状态徽章样式映射
const STATUS_STYLES = {
  success: 'bg-emerald-50/90 text-emerald-600 border-emerald-100',
  failed: 'bg-rose-50/90 text-rose-600 border-rose-100',
  other: 'bg-indigo-50/90 text-indigo-600 border-indigo-100',
};

// 辅助函数：兼容远端任务记录与本地生成记录，取结果图列表
const getRecordImages = (record) => {
  if (!record) return [];
  if (Array.isArray(record.images) && record.images.length > 0) return record.images;
  if (record.api_file_url) return [record.api_file_url];
  return [];
};

// 辅助函数：兼容取提示词/尺寸/模型/时间（远端字段在 input 内，本地记录在顶层）
const getRecordPrompt = (record) => record?.input?.prompt ?? record?.prompt ?? '';
const getRecordSize = (record) => record?.input?.size ?? record?.size ?? '';
const getRecordModel = (record) => record?.model ?? '';
const getRecordTime = (record) => record?.created_at ?? record?.timestamp ?? '';

export default function App() {
  // --- 状态管理 ---
  const [apiKey, setApiKey] = useState(() => getStoredItem('pear_api_key', '3e93dd710fb64a2d'));
  const [privateKey, setPrivateKey] = useState(() => getStoredItem('pear_private_key', 'ce0cbc30-1691-48d7-ab7c-d410c646c97b')); // 任务列表/详情查询用
  const [apiModels, setApiModels] = useState(loadCachedModels);
  const [isModelsLoading, setIsModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [showSettings, setShowSettings] = useState(true);

  // 余额状态
  const [balanceData, setBalanceData] = useState(null);
  const [isBalanceLoading, setIsBalanceLoading] = useState(false);

  // 生成参数状态
  const [prompt, setPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState(() => loadCachedModels()[0]?.model_id || '');
  const [activeVariantId, setActiveVariantId] = useState(null); // 当前选中模型的渠道变体 id
  const [selectedResolution, setSelectedResolution] = useState(null); // 当前选中的清晰度档位（如 "2K"）
  const [size, setSize] = useState('16:9');
  const [taskType, setTaskType] = useState('async'); 
  const [selectedFiles, setSelectedFiles] = useState([]);

  // 任务状态
  const [status, setStatus] = useState('idle'); 
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [resultImages, setResultImages] = useState([]);
  const [currentTaskId, setCurrentTaskId] = useState('');
  
  // 历史记录与视图状态
  const [history, setHistory] = useState(() => getStoredItem('pear_history', []));
  const [view, setView] = useState('current'); // 'current' | 'history'
  const [selectedRecord, setSelectedRecord] = useState(null); // 当前查看详情的任务记录
  const [isDetailLoading, setIsDetailLoading] = useState(false); // 详情接口刷新中
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1); // 任务列表当前页码
  const [historyHasMore, setHistoryHasMore] = useState(false); // 是否还有下一页
  const currentGenRef = useRef({ prompt: '', model: '', size: '' });

  const pollTimeoutRef = useRef(null);

  // --- 模型派生数据 ---
  // 按 model_id 分组去重后的列表（供下拉/侧边栏遍历）
  const modelGroups = useMemo(() => groupModelsByModelId(apiModels), [apiModels]);

  // 当前选中模型的所有渠道变体
  const selectedVariants = useMemo(
    () => apiModels.filter(m => m.model_id === selectedModel),
    [apiModels, selectedModel]
  );

  // 当前生效的渠道变体（activeVariantId 失效时回退到默认渠道）
  const activeVariant = useMemo(() => {
    const found = selectedVariants.find(v => v.id === activeVariantId);
    return found || pickDefaultVariant(selectedVariants);
  }, [selectedVariants, activeVariantId]);

  const sizeOptions = useMemo(() => {
    const parsed = parseAspectRatios(activeVariant?.aspect_ratio).filter(r => r !== 'auto');
    return parsed.length > 0 ? ['auto', ...parsed] : DEFAULT_SIZES;
  }, [activeVariant]);

  const maxRefImages = activeVariant?.reference_image != null
    ? Math.min(activeVariant.reference_image, 8)
    : 8;

  // 当前渠道变体的清晰度价格档位（如 [["1K", 0.042], ["2K", 0.05]]）
  const resolutionEntries = useMemo(() => {
    const rp = activeVariant?.billing_detail?.resolution_prices;
    return rp && typeof rp === 'object' ? Object.entries(rp) : [];
  }, [activeVariant]);

  const defaultResolution = activeVariant?.billing_detail?.default_resolution || '';

  // --- 获取历史记录接口（POST 任务列表，支持分页） ---
  const fetchHistory = async (page = 1) => {
    if (!privateKey) return;
    setIsHistoryLoading(true);
    try {
      const response = await fetch(`${API_BASE}/system/auth/task/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          private_key: privateKey,
          page,
          pageSize: 20,
        })
      });
      const data = await response.json();
      if (data.code === 200) {
        const list = data.data?.list || [];
        const pagination = data.data?.pagination || {};
        setHistory(prev => (page > 1 ? [...prev, ...list] : list));
        setHistoryPage(page);
        setHistoryHasMore(Boolean(pagination.has_more));
      }
    } catch (err) {
      console.error('Error fetching history:', err);
    } finally {
      setIsHistoryLoading(false);
    }
  };

  // --- 按 task_id 查询任务详情（逗号分隔最多 10 个，这里单个查询） ---
  const fetchTaskDetail = async (taskId) => {
    if (!privateKey || !taskId) return;
    setIsDetailLoading(true);
    try {
      const response = await fetch(`${API_BASE}/system/auth/task/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          private_key: privateKey,
          task_id: taskId,
        })
      });
      const data = await response.json();
      if (data.code === 200) {
        // 兼容多种返回结构：数组 / { list } / 单对象
        const payload = data.data;
        let detail = null;
        if (Array.isArray(payload)) {
          detail = payload.find(t => t?.task_id === taskId) || payload[0];
        } else if (Array.isArray(payload?.list)) {
          detail = payload.list.find(t => t?.task_id === taskId) || payload.list[0];
        } else if (payload && typeof payload === 'object') {
          detail = payload;
        }
        if (detail) {
          // 仅当用户仍停留在该任务详情时更新
          setSelectedRecord(prev => (prev && prev.task_id === taskId ? { ...prev, ...detail } : prev));
        }
      }
    } catch (err) {
      console.error('Error fetching task detail:', err);
    } finally {
      setIsDetailLoading(false);
    }
  };

  // --- 点击列表项查看详情：先展示列表数据，再异步刷新最新状态 ---
  const handleOpenDetail = (record) => {
    setSelectedRecord(record);
    if (record.task_id) fetchTaskDetail(record.task_id);
  };

  // --- 获取余额接口 ---
  const fetchBalance = async () => {
    if (!apiKey) return;
    setIsBalanceLoading(true);
    try {
      const response = await fetch(`${API_BASE}/system/auth/get_balance/?token=${apiKey}`);
      const data = await response.json();
      if (data.code === 200) {
        setBalanceData(data.data);
      } else {
        console.error('Failed to fetch balance:', data.message);
      }
    } catch (err) {
      console.error('Error fetching balance:', err);
    } finally {
      setIsBalanceLoading(false);
    }
  };

  // --- 副作用 ---
  useEffect(() => {
    setStoredItem('pear_api_key', apiKey);
    if (apiKey) {
      fetchBalance();
    } else {
      setBalanceData(null);
    }
  }, [apiKey]);

  // privateKey 变化时持久化并重新拉取任务列表第一页
  useEffect(() => {
    setStoredItem('pear_private_key', privateKey);
    if (privateKey) {
      fetchHistory(1);
    } else {
      setHistory([]);
      setHistoryPage(1);
      setHistoryHasMore(false);
    }
  }, [privateKey]);

  // 切换到历史视图时刷新任务列表第一页
  useEffect(() => {
    if (view === 'history' && privateKey) {
      fetchHistory(1);
    }
  }, [view]);

  // --- 获取模型列表接口 ---
  const fetchModels = async () => {
    setIsModelsLoading(true);
    setModelsError('');
    try {
      const response = await fetch(MODELS_API_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.code === 200 && Array.isArray(data.data) && data.data.length > 0) {
        setApiModels(data.data);
      } else {
        throw new Error(i18nText(data.message) || '接口返回数据异常');
      }
    } catch (err) {
      console.error('Error fetching models:', err);
      setModelsError('模型列表获取失败，已使用本地缓存/默认列表');
    } finally {
      setIsModelsLoading(false);
    }
  };

  // 挂载时拉取模型列表，并清理旧版写死模型的本地存储
  useEffect(() => {
    localStorage.removeItem('pear_models');
    fetchModels();
  }, []);

  useEffect(() => {
    setStoredItem('pear_api_models', apiModels);
    setSelectedModel(prev => (apiModels.some(m => m.model_id === prev) ? prev : apiModels[0]?.model_id || ''));
  }, [apiModels]);

  useEffect(() => {
    if (sizeOptions.length > 0 && !sizeOptions.includes(size)) {
      setSize('auto');
    }
  }, [sizeOptions, size]);

  // 切换模型/渠道后，清晰度自动预选该变体的默认档位
  useEffect(() => {
    setSelectedResolution(defaultResolution || null);
  }, [defaultResolution]);

  useEffect(() => {
    setSelectedFiles(files => (files.length > maxRefImages ? files.slice(0, maxRefImages) : files));
  }, [maxRefImages]);

  useEffect(() => {
    return () => clearTimeout(pollTimeoutRef.current);
  }, []);

  useEffect(() => {
    setStoredItem('pear_history', history);
  }, [history]);

  // --- 交互处理 ---
  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    if (selectedFiles.length + files.length > maxRefImages) {
      alert(`当前模型最多上传 ${maxRefImages} 张参考图`);
      return;
    }
    setSelectedFiles([...selectedFiles, ...files].slice(0, maxRefImages));
  };

  const handleRemoveFile = (index) => {
    setSelectedFiles(selectedFiles.filter((_, i) => i !== index));
  };

  // --- 下载图片功能 ---
  const handleDownload = async (url, index) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `magic-image-${Date.now()}-${index + 1}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Download failed', err);
      alert('下载失败，请尝试右键另存为');
    }
  };

  // --- 核心 API 调用 ---
  const addToHistory = (urls) => {
    if (!urls || urls.length === 0) return;
    const newRecord = {
      id: Date.now().toString(),
      timestamp: new Date().toLocaleString(),
      images: urls,
      prompt: currentGenRef.current.prompt,
      model: currentGenRef.current.model,
      size: currentGenRef.current.size,
    };
    setHistory(prev => [newRecord, ...prev].slice(0, 50)); 
    fetchBalance(); // 生成成功后刷新余额
  };

  const handleGenerate = async () => {
    if (!apiKey) {
      setErrorMsg('请先在左侧配置 API Key');
      return;
    }
    if (!prompt.trim()) {
      setErrorMsg('请输入提示词 (Prompt)');
      return;
    }
    if (!selectedModel) {
      setErrorMsg('请选择一个模型');
      return;
    }

    setErrorMsg('');
    setResultImages([]);
    setProgress(0);
    setCurrentTaskId('');
    clearTimeout(pollTimeoutRef.current);
    
    currentGenRef.current = { prompt, model: selectedModel, size };
    setView('current');

    setStatus(taskType === 'sync' ? 'loading' : 'queued');

    const apiUrl = `${API_BASE}/api/image_generate`;
    let options = { method: 'POST' };

    try {
      // 清晰度参数：仅当所选档位属于当前模型变体的 resolution_prices 时传递（小写，如 "2k"）
      const resolutionParam = resolutionEntries.some(([k]) => k === selectedResolution)
        ? selectedResolution.toLowerCase()
        : null;

      if (selectedFiles.length > 0) {
        const formData = new FormData();
        formData.append('key', apiKey);
        formData.append('prompt', prompt);
        formData.append('model', selectedModel);
        formData.append('size', size);
        formData.append('task_type', taskType);
        if (resolutionParam) formData.append('resolution', resolutionParam);
        
        selectedFiles.forEach((file) => {
          formData.append('images[]', file);
        });
        options.body = formData;
      } else {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify({
          key: apiKey,
          prompt,
          model: selectedModel,
          size,
          task_type: taskType,
          ...(resolutionParam ? { resolution: resolutionParam } : {})
        });
      }

      const response = await fetch(apiUrl, options);
      const data = await response.json();

      if (data.code !== 200) {
        throw new Error(data.msg || data.detail || '请求失败，请检查参数或网络');
      }

      if (taskType === 'sync') {
        const urls = data.data.image_urls || [];
        setResultImages(urls);
        setStatus('completed');
        addToHistory(urls);
      } else {
        const taskId = data.data.task_id;
        setCurrentTaskId(taskId);
        setStatus('queued');
        pollTask(taskId);
      }

    } catch (err) {
      setStatus('error');
      setErrorMsg(err.message || '网络请求异常，可能存在跨域拦截或接口宕机');
    }
  };

  const pollTask = async (taskId) => {
    try {
      const response = await fetch(`${API_BASE}/api/image_generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: apiKey,
          task_id: taskId
        })
      });
      
      const data = await response.json();

      if (data.code !== 200) {
        throw new Error(data.msg || data.detail || '查询任务失败');
      }

      const taskStatus = data.data.status;
      setProgress(data.data.progress || 0);

      if (taskStatus === 'completed') {
        const urls = data.data.image_urls || [];
        setResultImages(urls);
        setStatus('completed');
        addToHistory(urls);
      } else if (taskStatus === 'failed') {
        throw new Error('云端生成任务失败');
      } else {
        setStatus(taskStatus === 'running' ? 'running' : 'queued');
        pollTimeoutRef.current = setTimeout(() => pollTask(taskId), 3000);
      }

    } catch (err) {
      setStatus('error');
      setErrorMsg(err.message || '轮询任务状态时发生异常');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col md:flex-row relative overflow-hidden">
      
      {/* 动态液态模糊背景 (Liquid Background) */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute -top-[10%] -left-[10%] w-[50vw] h-[50vw] rounded-full bg-gradient-to-br from-indigo-300/40 to-purple-300/40 blur-[100px] mix-blend-multiply" />
        <div className="absolute top-[20%] -right-[10%] w-[45vw] h-[45vw] rounded-full bg-gradient-to-br from-cyan-300/40 to-blue-300/40 blur-[120px] mix-blend-multiply" />
        <div className="absolute -bottom-[20%] left-[20%] w-[60vw] h-[60vw] rounded-full bg-gradient-to-br from-pink-300/30 to-rose-300/30 blur-[120px] mix-blend-multiply" />
      </div>

      {/* --- 左侧边栏：配置与模型管理 --- */}
      <div className={`w-full md:w-80 bg-white/40 backdrop-blur-2xl border-r border-white/60 shadow-[4px_0_24px_-10px_rgba(0,0,0,0.05)] z-10 flex flex-col transition-all duration-300 ${showSettings ? 'block' : 'hidden md:flex'}`}>
        <div className="p-6 border-b border-white/50 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-xl text-indigo-600 drop-shadow-sm">
            <Sparkles className="w-6 h-6 text-cyan-500" />
            MagicImage
          </div>
          <button className="md:hidden text-slate-500 hover:text-slate-800" onClick={() => setShowSettings(false)}>
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto space-y-8 custom-scrollbar">
          {/* API Key 配置 */}
          <section className="space-y-3">
            <h3 className="text-sm font-bold text-slate-500/80 uppercase tracking-wider flex items-center gap-2">
              <Settings className="w-4 h-4" /> 全局设置
            </h3>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-600">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full bg-white/50 backdrop-blur-sm border border-white/60 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:bg-white/80 focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none transition-all shadow-inner"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-600">Private Key（任务查询）</label>
              <input
                type="text"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="private_key"
                className="w-full bg-white/50 backdrop-blur-sm border border-white/60 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:bg-white/80 focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none transition-all shadow-inner"
              />
            </div>
          </section>

          {/* 模型管理 */}
          <section className="space-y-3">
            <h3 className="text-sm font-bold text-slate-500/80 uppercase tracking-wider flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Server className="w-4 h-4" /> 模型管理
              </span>
              <button
                onClick={fetchModels}
                disabled={isModelsLoading}
                title="刷新模型列表"
                className="text-indigo-400 hover:text-indigo-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isModelsLoading ? 'animate-spin' : ''}`} />
              </button>
            </h3>

            {modelsError && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">{modelsError}</p>
            )}

            <div className="space-y-2 max-h-96 overflow-y-auto pr-1 custom-scrollbar">
              {apiModels.length === 0 && !isModelsLoading && (
                <p className="text-xs text-slate-500 text-center py-4 bg-white/30 rounded-xl">暂无可用模型</p>
              )}
              {modelGroups.map(variants => {
                const head = variants[0];
                const active = head.model_id === selectedModel;
                return (
                  <button
                    key={head.model_id}
                    type="button"
                    onClick={() => setSelectedModel(head.model_id)}
                    className={`w-full text-left flex items-center justify-between gap-2 p-3 rounded-xl border shadow-sm transition-all ${
                      active
                        ? 'bg-indigo-500/10 border-indigo-300 shadow-indigo-100'
                        : 'bg-white/40 backdrop-blur-sm border-white/60 hover:bg-white/70'
                    }`}
                  >
                    <span className="text-sm font-medium truncate text-slate-700" title={head.model_id}>{head.model_name}</span>
                    <span className="text-xs font-bold text-indigo-600 shrink-0">{formatPriceForList(variants)}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        {/* --- 底部余额显示卡片 --- */}
        <div className="p-4 border-t border-white/50">
          <div className="bg-gradient-to-br from-indigo-500/10 to-cyan-500/10 backdrop-blur-xl border border-white/80 rounded-2xl p-4 shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-2">
                <button 
                  onClick={fetchBalance}
                  disabled={isBalanceLoading || !apiKey}
                  className={`text-indigo-400 hover:text-indigo-600 transition-all ${isBalanceLoading ? 'animate-spin' : ''}`}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
            </div>
            
            <div className="flex items-center gap-3 mb-3">
              <div className="bg-indigo-500 text-white p-2 rounded-xl shadow-sm">
                <Wallet className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">个人账户余额</h4>
                <p className="text-[10px] text-slate-400 truncate max-w-[140px]" title={balanceData?.member || '未登录'}>
                  {balanceData?.member || 'API Key 未配置'}
                </p>
              </div>
            </div>

            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-black text-indigo-600 tabular-nums">
                {balanceData ? balanceData.balance : '0.00'}
              </span>
              <span className="text-xs font-bold text-slate-400 uppercase">Credits</span>
            </div>
            
            {/* 装饰性元素 */}
            <div className="absolute -bottom-2 -right-2 opacity-5 group-hover:opacity-10 transition-opacity">
               <User className="w-16 h-16" />
            </div>
          </div>
        </div>
      </div>

      {/* --- 右侧主区域：生成与结果 --- */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden z-10">
        
        {/* 移动端顶部栏 */}
        <div className="md:hidden bg-white/50 backdrop-blur-xl p-4 flex items-center justify-between border-b border-white/60 z-20 shadow-sm">
          <div className="flex items-center gap-2 font-bold text-lg text-indigo-600">
            <ImageIcon className="w-5 h-5 text-cyan-500" /> 图像生成
          </div>
          <button onClick={() => setShowSettings(true)} className="text-slate-600 bg-white/50 p-2 rounded-xl border border-white/60">
            <Settings className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 flex flex-col xl:flex-row gap-6 lg:gap-8 custom-scrollbar">
          
          {/* 左半部分：生成表单 */}
          <div className="w-full xl:w-1/2 space-y-6 flex flex-col">
            
            <div className="bg-white/40 backdrop-blur-2xl rounded-3xl p-6 md:p-8 shadow-[0_8px_32px_0_rgba(31,38,135,0.05)] border border-white/60 space-y-6">
              <h2 className="text-2xl font-extrabold mb-2 flex items-center gap-2 text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-cyan-500">
                <Play className="w-6 h-6 text-indigo-500 fill-indigo-500" /> 创建新创作
              </h2>

              <div className="grid grid-cols-2 gap-5">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">选择模型</label>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    disabled={isModelsLoading && apiModels.length === 0}
                    className="w-full bg-white/50 backdrop-blur-md border border-white/80 rounded-2xl px-4 py-3 text-sm font-medium focus:bg-white/80 focus:ring-2 focus:ring-indigo-400 outline-none appearance-none shadow-inner text-slate-700 cursor-pointer disabled:cursor-wait"
                  >
                    {modelGroups.length === 0 && (
                      <option value="">{isModelsLoading ? '模型列表加载中...' : '暂无可用模型'}</option>
                    )}
                    {modelGroups.map(variants => (
                      <option key={variants[0].model_id} value={variants[0].model_id}>
                        {variants[0].model_name}（{formatPriceForList(variants)}）
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">图像尺寸</label>
                  <select
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                    className="w-full bg-white/50 backdrop-blur-md border border-white/80 rounded-2xl px-4 py-3 text-sm font-medium focus:bg-white/80 focus:ring-2 focus:ring-indigo-400 outline-none appearance-none shadow-inner text-slate-700 cursor-pointer"
                  >
                    {sizeOptions.map(r => (
                      <option key={r} value={r}>{r === 'auto' ? 'Auto (自动)' : r}</option>
                    ))}
                  </select>
                </div>
              </div>

              {activeVariant && (
                <div className="bg-white/40 backdrop-blur-sm border border-white/60 rounded-2xl p-4 space-y-2 shadow-inner">
                  <div className="flex flex-wrap items-center gap-2">
                    {activeVariant.provider && (
                      <span className="bg-indigo-50/80 text-indigo-600 text-xs font-bold px-2.5 py-0.5 rounded-md border border-indigo-100">
                        {activeVariant.provider}
                      </span>
                    )}
                    {selectedVariants.length > 1 ? (
                      selectedVariants.map(v => {
                        const isActive = v.id === activeVariant.id;
                        return (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => setActiveVariantId(v.id)}
                            title={`切换到${channelLabel(v) || '该渠道'}（${formatPriceShort(v)}）`}
                            className={`text-xs font-bold px-2.5 py-0.5 rounded-md border transition-all cursor-pointer ${
                              isActive
                                ? 'bg-indigo-500 text-white border-indigo-500 shadow-sm'
                                : 'bg-white/80 text-slate-500 border-white hover:border-indigo-300 hover:text-indigo-600'
                            }`}
                          >
                            {channelLabel(v) || '渠道'}
                          </button>
                        );
                      })
                    ) : (
                      channelLabel(activeVariant) && (
                        <span className="bg-white/80 text-slate-500 text-xs font-bold px-2.5 py-0.5 rounded-md border border-white">
                          {channelLabel(activeVariant)}
                        </span>
                      )
                    )}
                    <span className="bg-cyan-50/80 text-cyan-600 text-xs font-bold px-2.5 py-0.5 rounded-md border border-cyan-100">
                      {formatPriceShort(activeVariant)}
                    </span>
                  </div>

                  {resolutionEntries.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">清晰度</span>
                      {resolutionEntries.map(([res, price]) => {
                        const isSelected = selectedResolution === res;
                        const isDefault = defaultResolution === res;
                        return (
                          <button
                            key={res}
                            type="button"
                            onClick={() => setSelectedResolution(res)}
                            className={`text-xs font-bold px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm'
                                : 'bg-white/70 text-slate-500 border-white hover:border-emerald-300 hover:text-emerald-600'
                            }`}
                          >
                            {res} ¥{price}{isDefault ? ' · 默认' : ''}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    i18nText(activeVariant.billing_summary) && (
                      <p className="text-xs text-slate-500">{i18nText(activeVariant.billing_summary)}</p>
                    )
                  )}

                  {i18nText(activeVariant.description) && (
                    <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">{i18nText(activeVariant.description)}</p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">提示词 (Prompt)</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="描述您想要生成的奇妙图像..."
                  rows={4}
                  className="w-full bg-white/50 backdrop-blur-md border border-white/80 rounded-2xl px-5 py-4 text-sm focus:bg-white/80 focus:ring-2 focus:ring-indigo-400 outline-none resize-none shadow-inner text-slate-700 placeholder-slate-400"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1 flex items-center justify-between">
                  <span>参考图 / 垫图 (可选)</span>
                  <span className="bg-white/60 px-2 py-0.5 rounded-md text-slate-500">{selectedFiles.length}/{maxRefImages}</span>
                </label>
                
                {selectedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-3 mb-3 p-3 bg-white/30 rounded-2xl border border-white/50 shadow-inner">
                    {selectedFiles.map((file, idx) => (
                      <div key={idx} className="relative w-16 h-16 rounded-xl overflow-hidden shadow-sm group">
                        <img src={URL.createObjectURL(file)} alt="preview" className="w-full h-full object-cover" />
                        <button 
                          onClick={() => handleRemoveFile(idx)}
                          className="absolute inset-0 bg-white/60 backdrop-blur-sm opacity-0 group-hover:opacity-100 flex items-center justify-center text-rose-500 transition-all"
                        >
                          <X className="w-5 h-5 drop-shadow-md" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {maxRefImages === 0 ? (
                  <p className="w-full text-center text-xs text-slate-400 bg-white/30 rounded-2xl px-4 py-4 border border-white/50">
                    当前模型不支持参考图上传
                  </p>
                ) : (
                  <label className="flex flex-col items-center justify-center w-full h-14 transition bg-white/30 backdrop-blur-sm border-2 border-indigo-200 border-dashed rounded-2xl appearance-none cursor-pointer hover:bg-white/60 hover:border-indigo-400 hover:shadow-md focus:outline-none">
                      <span className="flex items-center space-x-2 text-sm text-indigo-500">
                          <Upload className="w-5 h-5" />
                          <span className="font-semibold">点击选择图片上传（最多 {maxRefImages} 张）</span>
                      </span>
                      <input type="file" multiple accept="image/*" className="hidden" onChange={handleFileChange} />
                  </label>
                )}
              </div>

              <div className="pt-6 mt-4 flex flex-col sm:flex-row items-center justify-between border-t border-white/50 gap-4">
                <div className="flex bg-white/40 backdrop-blur-md rounded-xl p-1 border border-white/60 shadow-sm w-full sm:w-auto">
                  <button
                    onClick={() => setTaskType('sync')}
                    className={`flex-1 sm:flex-none px-4 py-2 text-sm font-semibold rounded-lg transition-all ${taskType === 'sync' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'}`}
                  >
                    同步等待
                  </button>
                  <button
                    onClick={() => setTaskType('async')}
                    className={`flex-1 sm:flex-none px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 ${taskType === 'async' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'}`}
                  >
                    <Clock className="w-4 h-4" /> 异步轮询
                  </button>
                </div>

                <button
                  onClick={handleGenerate}
                  disabled={status === 'loading' || status === 'queued' || status === 'running'}
                  className="w-full sm:w-auto bg-gradient-to-br from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 disabled:from-slate-300 disabled:to-slate-300 disabled:text-slate-500 text-white font-bold px-8 py-3 rounded-xl shadow-[0_4px_14px_0_rgba(99,102,241,0.39)] hover:shadow-[0_6px_20px_rgba(99,102,241,0.23)] border border-indigo-400/50 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  {(status === 'loading' || status === 'queued' || status === 'running') ? (
                    <><Loader2 className="w-5 h-5 animate-spin" /> 处理中...</>
                  ) : (
                    <><Sparkles className="w-5 h-5" /> 立即生成</>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* 右半部分：结果展示区 */}
          <div className="w-full xl:w-1/2 flex flex-col bg-white/40 backdrop-blur-2xl rounded-3xl shadow-[0_8px_32px_0_rgba(31,38,135,0.05)] border border-white/60 overflow-hidden min-h-[500px]">
            <div className="p-5 border-b border-white/50 bg-white/30 flex justify-between items-center z-10">
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => { setView('current'); setSelectedRecord(null); }}
                  className={`font-bold flex items-center gap-2 text-lg transition-colors ${view === 'current' ? 'text-indigo-800' : 'text-slate-400 hover:text-indigo-500'}`}
                >
                  <ImageIcon className={`w-5 h-5 ${view === 'current' ? 'text-indigo-500' : ''}`} /> 创作结果
                </button>
                <div className="w-px h-5 bg-white/60"></div>
                <button 
                  onClick={() => { setView('history'); setSelectedRecord(null); }}
                  className={`font-bold flex items-center gap-2 text-lg transition-colors ${view === 'history' ? 'text-indigo-800' : 'text-slate-400 hover:text-indigo-500'}`}
                >
                  <History className={`w-5 h-5 ${view === 'history' ? 'text-indigo-500' : ''}`} /> 历史记录
                </button>
              </div>
              
              {/* 状态指示徽章 */}
              {status !== 'idle' && view === 'current' && (
                <div className={`px-4 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 shadow-sm
                  ${status === 'completed' ? 'bg-emerald-100 text-emerald-600 border border-emerald-200' : 
                    status === 'error' ? 'bg-rose-100 text-rose-600 border border-rose-200' : 
                    'bg-indigo-100 text-indigo-600 border border-indigo-200'}`}
                >
                  {status === 'completed' && <CheckCircle2 className="w-4 h-4" />}
                  {status === 'error' && <AlertCircle className="w-4 h-4" />}
                  {(status === 'queued' || status === 'running' || status === 'loading') && <Loader2 className="w-4 h-4 animate-spin" />}
                  
                  {status === 'loading' && '同步生成中...'}
                  {status === 'queued' && '云端排队中...'}
                  {status === 'running' && `绘制中 (${progress}%)`}
                  {status === 'completed' && '生成完成'}
                  {status === 'error' && '发生错误'}
                </div>
              )}
            </div>

            <div className="flex-1 p-6 md:p-8 flex flex-col relative bg-white/10 overflow-hidden">
              
              {/* --- 当前结果视图 --- */}
              {view === 'current' && (
                <div className="w-full h-full flex flex-col items-center justify-center">
                  
                  {status === 'idle' && (
                    <div className="text-slate-400 flex flex-col items-center gap-4">
                      <div className="w-20 h-20 bg-white/50 rounded-3xl shadow-inner flex items-center justify-center border border-white/60">
                        <ImageIcon className="w-10 h-10 text-indigo-300" />
                      </div>
                      <p className="text-sm font-medium">配置参数后点击生成，见证奇迹</p>
                    </div>
                  )}

                  {(status === 'loading' || status === 'queued' || status === 'running') && (
                    <div className="w-full max-w-sm space-y-8 text-center bg-white/50 backdrop-blur-sm p-8 rounded-3xl border border-white/60 shadow-xl shadow-indigo-100/50">
                      <div className="relative w-24 h-24 mx-auto drop-shadow-md">
                        <div className="absolute inset-0 rounded-full border-[6px] border-indigo-100"></div>
                        <div className="absolute inset-0 rounded-full border-[6px] border-indigo-500 border-t-transparent animate-spin"></div>
                        <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-indigo-600">
                          {status === 'running' ? `${progress}%` : '...'}
                        </div>
                      </div>
                      <div className="space-y-3">
                        <p className="text-indigo-900 font-bold text-lg">
                          {status === 'loading' && '正在生成图像...'}
                          {status === 'queued' && '正在云端排队中...'}
                          {status === 'running' && 'AI 正在挥洒创意...'}
                        </p>
                        {currentTaskId && (
                          <p className="text-xs text-slate-500 font-mono bg-white/60 py-1 px-3 rounded-full inline-block border border-white/80">
                            ID: {currentTaskId.substring(0, 8)}...
                          </p>
                        )}
                      </div>
                      
                      {(status === 'queued' || status === 'running') && (
                        <div className="w-full bg-white/60 rounded-full h-3 overflow-hidden border border-white/80 shadow-inner">
                          <div 
                            className="bg-gradient-to-r from-cyan-400 via-indigo-500 to-purple-500 h-full rounded-full transition-all duration-500 ease-out shadow-sm"
                            style={{ width: `${Math.max(5, progress)}%` }}
                          ></div>
                        </div>
                      )}
                    </div>
                  )}

                  {status === 'error' && (
                    <div className="flex flex-col items-center gap-4 max-w-md text-center bg-white/60 backdrop-blur-md p-8 rounded-3xl border border-rose-200 shadow-xl shadow-rose-100/50">
                      <div className="w-16 h-16 bg-rose-100 rounded-2xl flex items-center justify-center text-rose-500 shadow-inner">
                        <AlertCircle className="w-8 h-8" />
                      </div>
                      <p className="font-semibold text-rose-700 leading-relaxed">{errorMsg}</p>
                    </div>
                  )}

                  {status === 'completed' && resultImages.length > 0 && (
                    <div className={`w-full h-full grid gap-6 overflow-y-auto custom-scrollbar ${resultImages.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                      {resultImages.map((url, index) => (
                        <div 
                          key={index} 
                          className="relative group rounded-2xl overflow-hidden border-[4px] border-white/80 bg-white shadow-lg hover:border-indigo-300 transition-all duration-300"
                        >
                          <div className="absolute inset-0 flex items-center justify-center bg-slate-50 text-slate-400 text-sm font-medium">载入中...</div>
                          <img 
                            src={url} 
                            alt={`Generated ${index + 1}`} 
                            className="w-full h-full object-cover relative z-10 group-hover:scale-[1.03] transition-transform duration-500 ease-out"
                            loading="lazy"
                          />
                          
                          <div className="absolute inset-0 bg-gradient-to-t from-indigo-900/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20 flex items-end justify-between p-4">
                            <a 
                              href={url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="bg-white/30 backdrop-blur-md text-white border border-white/40 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm hover:bg-white/50 transition-colors"
                            >
                              查看原图 ↗
                            </a>
                            <button 
                              onClick={() => handleDownload(url, index)}
                              className="bg-indigo-500 text-white p-2 rounded-lg shadow-lg hover:bg-indigo-600 transition-all transform active:scale-95"
                              title="下载到本地"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* --- 历史记录视图：详情 --- */}
              {view === 'history' && selectedRecord && (
                <div className="w-full h-full absolute inset-0 p-6 md:p-8 overflow-y-auto custom-scrollbar">
                  {/* 顶部返回栏 */}
                  <div className="flex items-center justify-between gap-3 mb-6">
                    <button
                      onClick={() => setSelectedRecord(null)}
                      className="flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-indigo-600 bg-white/60 border border-white/80 px-3 py-2 rounded-xl shadow-sm transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" /> 返回列表
                    </button>
                    {selectedRecord.task_id && (
                      <span
                        className="text-xs font-mono text-slate-400 bg-white/60 border border-white/80 px-3 py-2 rounded-xl shadow-sm truncate max-w-[60%]"
                        title={selectedRecord.task_id}
                      >
                        ID: {selectedRecord.task_id}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-col lg:flex-row gap-6 pb-10">
                    {/* 左侧：结果图片预览 */}
                    <div className="lg:w-1/2 space-y-4 shrink-0">
                      {getRecordImages(selectedRecord).length > 0 ? (
                        getRecordImages(selectedRecord).map((url, i) => (
                          <div key={i} className="relative group rounded-2xl overflow-hidden border-[4px] border-white/80 bg-white shadow-lg">
                            <div className="flex items-center justify-center bg-slate-50 text-slate-400 text-sm font-medium min-h-[120px]">载入中...</div>
                            <img
                              src={url}
                              alt={`Result ${i + 1}`}
                              className="w-full object-contain max-h-[60vh] relative z-10 bg-slate-50"
                            />
                            <div className="absolute inset-x-0 bottom-0 z-20 p-3 flex justify-end gap-2 bg-gradient-to-t from-indigo-900/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="bg-white/30 backdrop-blur-md text-white border border-white/40 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-white/50 transition-colors"
                              >
                                查看原图 ↗
                              </a>
                              <button
                                onClick={() => handleDownload(url, i)}
                                className="bg-indigo-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 shadow hover:bg-indigo-600 transition-all active:scale-95"
                              >
                                <Download className="w-3.5 h-3.5" /> 下载
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="h-64 flex flex-col items-center justify-center gap-3 text-slate-400 bg-white/40 rounded-2xl border border-white/60">
                          <ImageIcon className="w-10 h-10 opacity-40" />
                          <p className="text-sm">暂无结果图片</p>
                        </div>
                      )}
                    </div>

                    {/* 右侧：基本信息与请求参数 */}
                    <div className="lg:w-1/2 space-y-4 min-w-0">
                      <div className="bg-white/60 backdrop-blur-md rounded-2xl border border-white/80 shadow-sm p-5 space-y-4">
                        <h4 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                          <Info className="w-4 h-4 text-indigo-400" /> 基本信息
                          {isDetailLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />}
                        </h4>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
                          {[
                            { label: '状态', value: selectedRecord.status || (selectedRecord.task_id ? '-' : '成功') },
                            { label: '模型', value: getRecordModel(selectedRecord) || '-' },
                            { label: '类型', value: selectedRecord.task_type || '-' },
                            { label: '模式', value: selectedRecord.mode || '-' },
                            { label: '进度', value: selectedRecord.progress != null ? `${selectedRecord.progress}%` : '-' },
                            { label: '扣费', value: selectedRecord.billing_amount != null ? String(selectedRecord.billing_amount) : '-' },
                            { label: '耗时', value: selectedRecord.duration_seconds != null ? `${selectedRecord.duration_seconds}s` : '-' },
                            { label: '生成时间', value: getRecordTime(selectedRecord) || '-' },
                          ].map(item => (
                            <div key={item.label} className="space-y-1 min-w-0">
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{item.label}</p>
                              {item.label === '状态' ? (
                                <span className={`inline-block text-xs font-bold px-2.5 py-0.5 rounded-md border ${STATUS_STYLES[getStatusKind(item.value)]}`}>
                                  {item.value}
                                </span>
                              ) : (
                                <p className="text-sm font-semibold text-slate-700 truncate" title={item.value}>{item.value}</p>
                              )}
                            </div>
                          ))}
                        </div>
                        {getRecordPrompt(selectedRecord) && (
                          <div className="space-y-1 pt-1 border-t border-white/60">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pt-2">提示词</p>
                            <p className="text-sm text-slate-600 leading-relaxed">{getRecordPrompt(selectedRecord)}</p>
                          </div>
                        )}
                      </div>

                      <div className="bg-white/60 backdrop-blur-md rounded-2xl border border-white/80 shadow-sm p-5 space-y-3">
                        <h4 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                          <Braces className="w-4 h-4 text-cyan-500" /> 请求参数
                        </h4>
                        <pre className="text-[11px] leading-relaxed text-slate-600 bg-white/70 border border-white/80 rounded-xl p-4 overflow-x-auto font-mono whitespace-pre-wrap break-all custom-scrollbar">
                          {JSON.stringify(
                            selectedRecord.input || {
                              prompt: selectedRecord.prompt,
                              model: selectedRecord.model,
                              size: selectedRecord.size,
                            },
                            null,
                            2
                          )}
                        </pre>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* --- 历史记录视图：列表 --- */}
              {view === 'history' && !selectedRecord && (
                <div className="w-full h-full absolute inset-0 p-6 md:p-8 overflow-y-auto custom-scrollbar">
                  {history.length === 0 && !isHistoryLoading ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-4">
                      <History className="w-16 h-16 opacity-30" />
                      <p className="text-sm font-medium">暂无生成记录</p>
                    </div>
                  ) : (
                    <div className="space-y-4 pb-10">
                      <div className="flex justify-between items-center mb-6">
                        <span className="text-sm font-bold text-slate-500 uppercase tracking-wider">任务列表（共 {history.length} 条）</span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => fetchHistory(1)}
                            disabled={isHistoryLoading || !privateKey}
                            title="刷新任务列表"
                            className="text-indigo-500 hover:text-indigo-600 bg-white/60 hover:bg-white px-2.5 py-1.5 rounded-lg transition-colors border border-white/80 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isHistoryLoading ? 'animate-spin' : ''}`} />
                          </button>
                          <button 
                            onClick={() => {
                              if(window.confirm('确定要清空所有历史记录吗？')) setHistory([]);
                            }}
                            className="text-xs text-rose-500 hover:text-rose-600 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded-lg transition-colors font-medium border border-rose-100 shadow-sm"
                          >
                            清空记录
                          </button>
                        </div>
                      </div>
                      {history.map((record) => {
                        const statusKind = getStatusKind(record.status || (record.task_id ? '' : '成功'));
                        const images = getRecordImages(record);
                        return (
                          <div
                            key={record.id}
                            onClick={() => handleOpenDetail(record)}
                            className="bg-white/60 backdrop-blur-md p-5 rounded-2xl border border-white/80 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all group cursor-pointer"
                          >
                            <div className="flex justify-between items-start mb-4">
                              <div className="space-y-2 pr-4 flex-1 min-w-0">
                                <p className="font-bold text-slate-700 text-sm line-clamp-2 leading-relaxed" title={getRecordPrompt(record)}>
                                  {getRecordPrompt(record) || '（无提示词）'}
                                </p>
                                <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md border ${STATUS_STYLES[statusKind]}`}>
                                    {statusKind === 'success' && <CheckCircle2 className="w-3 h-3" />}
                                    {statusKind === 'failed' && <AlertCircle className="w-3 h-3" />}
                                    {statusKind === 'other' && <Clock className="w-3 h-3" />}
                                    {record.status || (record.task_id ? '进行中' : '成功')}
                                  </span>
                                  {getRecordModel(record) && (
                                    <span className="bg-indigo-50/80 text-indigo-600 px-2.5 py-1 rounded-md border border-indigo-100/50">{getRecordModel(record)}</span>
                                  )}
                                  {getRecordSize(record) && (
                                    <span className="bg-white/80 px-2.5 py-1 rounded-md border border-white">{getRecordSize(record)}</span>
                                  )}
                                  {record.billing_amount != null && (
                                    <span className="bg-cyan-50/80 text-cyan-600 px-2.5 py-1 rounded-md border border-cyan-100/50">¥{record.billing_amount}</span>
                                  )}
                                  <span className="flex items-center text-slate-400 ml-1">{getRecordTime(record)}</span>
                                </div>
                              </div>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setHistory(history.filter(h => h.id !== record.id));
                                }}
                                className="text-slate-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity bg-white p-2 rounded-xl shadow-sm shrink-0 border border-white/80"
                                title="删除记录"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                            
                            {images.length > 0 && (
                              <div className="grid grid-cols-4 sm:grid-cols-5 xl:grid-cols-6 gap-3">
                                {images.map((url, i) => (
                                  <div 
                                    key={i}
                                    className="relative rounded-xl overflow-hidden aspect-square border-2 border-white/80 shadow-sm hover:border-indigo-300 transition-all bg-slate-50 group/img"
                                  >
                                    <img src={url} alt="History thumbnail" className="w-full h-full object-cover group-hover/img:scale-110 transition-transform duration-500" loading="lazy" />
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDownload(url, i);
                                      }}
                                      className="absolute bottom-1 right-1 bg-white/80 backdrop-blur-sm p-1 rounded shadow-sm opacity-0 group-hover/img:opacity-100 transition-opacity"
                                    >
                                      <Download className="w-3 h-3 text-indigo-600" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {historyHasMore && (
                        <div className="flex justify-center pt-2">
                          <button
                            onClick={() => fetchHistory(historyPage + 1)}
                            disabled={isHistoryLoading}
                            className="flex items-center gap-2 text-sm font-bold text-indigo-600 bg-white/70 hover:bg-white border border-indigo-200 px-6 py-2.5 rounded-xl shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isHistoryLoading ? (
                              <><Loader2 className="w-4 h-4 animate-spin" /> 加载中...</>
                            ) : (
                              <>加载更多</>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              
            </div>
          </div>

        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(99, 102, 241, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(99, 102, 241, 0.2);
        }
      `}</style>
      
    </div>
  );
}