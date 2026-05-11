import React, { useState, useEffect, useRef } from 'react';
import { 
  Settings, Image as ImageIcon, Loader2, Plus, Trash2, 
  CheckCircle2, AlertCircle, Upload, X, Play, Clock, Server, Sparkles, History
} from 'lucide-react';

// 辅助函数：从本地存储获取数据
const getStoredItem = (key, defaultValue) => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch (e) {
    return defaultValue;
  }
};

// 辅助函数：保存数据到本地存储
const setStoredItem = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error('Failed to save to localStorage', e);
  }
};

export default function App() {
  // --- 状态管理 ---
  const [apiKey, setApiKey] = useState(() => getStoredItem('pear_api_key', ''));
  const [models, setModels] = useState(() => getStoredItem('pear_models', ['gpt-image-2-2k', 'gpt-image-2-4k',  'gpt-image-2', 'grok-4-image', 'midjourney-v6']));
  const [newModelName, setNewModelName] = useState('');
  const [showSettings, setShowSettings] = useState(true);

  // 生成参数状态
  const [prompt, setPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState(models[0] || '');
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
  const currentGenRef = useRef({ prompt: '', model: '', size: '' });

  const pollTimeoutRef = useRef(null);

  // --- 副作用 ---
  useEffect(() => {
    setStoredItem('pear_api_key', apiKey);
  }, [apiKey]);

  useEffect(() => {
    setStoredItem('pear_models', models);
    if (!models.includes(selectedModel) && models.length > 0) {
      setSelectedModel(models[0]);
    }
  }, [models]);

  useEffect(() => {
    return () => clearTimeout(pollTimeoutRef.current);
  }, []);

  useEffect(() => {
    setStoredItem('pear_history', history);
  }, [history]);

  // --- 交互处理 ---
  const handleAddModel = (e) => {
    e.preventDefault();
    const trimmed = newModelName.trim();
    if (trimmed && !models.includes(trimmed)) {
      setModels([...models, trimmed]);
      setNewModelName('');
      setSelectedModel(trimmed);
    }
  };

  const handleRemoveModel = (modelToRemove) => {
    setModels(models.filter(m => m !== modelToRemove));
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    if (files.length + selectedFiles.length > 8) {
      alert('最多只能上传8张图片');
      return;
    }
    setSelectedFiles([...selectedFiles, ...files].slice(0, 8));
  };

  const handleRemoveFile = (index) => {
    setSelectedFiles(selectedFiles.filter((_, i) => i !== index));
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
    setHistory(prev => [newRecord, ...prev].slice(0, 50)); // 最多保留50条记录
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

    const apiUrl = 'https://api.pearapi.ai/api/image_generate';
    let options = { method: 'POST' };

    try {
      if (selectedFiles.length > 0) {
        const formData = new FormData();
        formData.append('key', apiKey);
        formData.append('prompt', prompt);
        formData.append('model', selectedModel);
        formData.append('size', size);
        formData.append('task_type', taskType);
        
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
          task_type: taskType
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
      const response = await fetch('https://api.pearapi.ai/api/image_generate', {
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

      {/* --- 左侧边栏：配置与模型管理 (Glassmorphism Sidebar) --- */}
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

        <div className="p-6 flex-1 overflow-y-auto space-y-8">
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
          </section>

          {/* 模型管理 */}
          <section className="space-y-3">
            <h3 className="text-sm font-bold text-slate-500/80 uppercase tracking-wider flex items-center gap-2">
              <Server className="w-4 h-4" /> 模型管理
            </h3>
            
            <form onSubmit={handleAddModel} className="flex gap-2">
              <input
                type="text"
                value={newModelName}
                onChange={(e) => setNewModelName(e.target.value)}
                placeholder="添加新模型..."
                className="flex-1 bg-white/50 backdrop-blur-sm border border-white/60 rounded-xl px-3 py-2 text-sm text-slate-800 focus:bg-white/80 focus:ring-2 focus:ring-indigo-400 outline-none shadow-inner"
              />
              <button 
                type="submit"
                disabled={!newModelName.trim()}
                className="bg-indigo-500/10 hover:bg-indigo-500 text-indigo-600 hover:text-white border border-indigo-200 hover:border-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-500/10 disabled:hover:text-indigo-600 disabled:cursor-not-allowed px-3 py-2 rounded-xl transition-colors shadow-sm"
              >
                <Plus className="w-5 h-5" />
              </button>
            </form>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
              {models.length === 0 && <p className="text-xs text-slate-500 text-center py-4 bg-white/30 rounded-xl">暂无模型，请添加</p>}
              {models.map(model => (
                <div key={model} className="flex items-center justify-between bg-white/40 backdrop-blur-sm p-3 rounded-xl border border-white/60 shadow-sm group hover:bg-white/60 transition-all">
                  <span className="text-sm font-medium truncate text-slate-700" title={model}>{model}</span>
                  <button 
                    onClick={() => handleRemoveModel(model)}
                    className="text-slate-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity bg-white/50 p-1.5 rounded-lg shadow-sm"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </section>
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

        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 flex flex-col xl:flex-row gap-6 lg:gap-8">
          
          {/* 左半部分：生成表单 (Glass Card) */}
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
                    className="w-full bg-white/50 backdrop-blur-md border border-white/80 rounded-2xl px-4 py-3 text-sm font-medium focus:bg-white/80 focus:ring-2 focus:ring-indigo-400 outline-none appearance-none shadow-inner text-slate-700 cursor-pointer"
                  >
                    {models.length === 0 && <option value="">请先在左侧添加模型</option>}
                    {models.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">图像尺寸</label>
                  <select
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                    className="w-full bg-white/50 backdrop-blur-md border border-white/80 rounded-2xl px-4 py-3 text-sm font-medium focus:bg-white/80 focus:ring-2 focus:ring-indigo-400 outline-none appearance-none shadow-inner text-slate-700 cursor-pointer"
                  >
                    <option value="auto">Auto (自动)</option>
                    <option value="1:1">1:1 (正方形)</option>
                    <option value="16:9">16:9 (横屏)</option>
                    <option value="9:16">9:16 (竖屏)</option>
                    <option value="4:3">4:3</option>
                    <option value="3:4">3:4</option>
                  </select>
                </div>
              </div>

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
                  <span className="bg-white/60 px-2 py-0.5 rounded-md text-slate-500">{selectedFiles.length}/8</span>
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

                <label className="flex flex-col items-center justify-center w-full h-14 transition bg-white/30 backdrop-blur-sm border-2 border-indigo-200 border-dashed rounded-2xl appearance-none cursor-pointer hover:bg-white/60 hover:border-indigo-400 hover:shadow-md focus:outline-none">
                    <span className="flex items-center space-x-2 text-sm text-indigo-500">
                        <Upload className="w-5 h-5" />
                        <span className="font-semibold">点击选择图片上传</span>
                    </span>
                    <input type="file" multiple accept="image/*" className="hidden" onChange={handleFileChange} />
                </label>
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

          {/* 右半部分：结果展示区 (Glass Panel) */}
          <div className="w-full xl:w-1/2 flex flex-col bg-white/40 backdrop-blur-2xl rounded-3xl shadow-[0_8px_32px_0_rgba(31,38,135,0.05)] border border-white/60 overflow-hidden min-h-[500px]">
            <div className="p-5 border-b border-white/50 bg-white/30 flex justify-between items-center z-10">
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setView('current')}
                  className={`font-bold flex items-center gap-2 text-lg transition-colors ${view === 'current' ? 'text-indigo-800' : 'text-slate-400 hover:text-indigo-500'}`}
                >
                  <ImageIcon className={`w-5 h-5 ${view === 'current' ? 'text-indigo-500' : ''}`} /> 创作结果
                </button>
                <div className="w-px h-5 bg-white/60"></div>
                <button 
                  onClick={() => setView('history')}
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
                      
                      {/* 进度条 */}
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
                    <div className={`w-full h-full grid gap-6 overflow-y-auto ${resultImages.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                      {resultImages.map((url, index) => (
                        <a 
                          key={index} 
                          href={url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="block relative rounded-2xl overflow-hidden border-[4px] border-white/80 bg-white shadow-lg group hover:border-indigo-300 transition-all duration-300"
                        >
                          <div className="absolute inset-0 flex items-center justify-center bg-slate-50 text-slate-400 text-sm font-medium">载入中...</div>
                          <img 
                            src={url} 
                            alt={`Generated ${index + 1}`} 
                            className="w-full h-full object-cover relative z-10 group-hover:scale-[1.03] transition-transform duration-500 ease-out"
                            loading="lazy"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-indigo-900/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20 flex items-end p-4">
                            <span className="bg-white/30 backdrop-blur-md text-white border border-white/40 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm">
                              查看原图 ↗
                            </span>
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* --- 历史记录视图 --- */}
              {view === 'history' && (
                <div className="w-full h-full absolute inset-0 p-6 md:p-8 overflow-y-auto custom-scrollbar">
                  {history.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-4">
                      <History className="w-16 h-16 opacity-30" />
                      <p className="text-sm font-medium">暂无生成记录</p>
                    </div>
                  ) : (
                    <div className="space-y-4 pb-10">
                      <div className="flex justify-between items-center mb-6">
                        <span className="text-sm font-bold text-slate-500 uppercase tracking-wider">最近生成 (最多保存50条)</span>
                        <button 
                          onClick={() => {
                            if(window.confirm('确定要清空所有历史记录吗？')) setHistory([]);
                          }}
                          className="text-xs text-rose-500 hover:text-rose-600 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded-lg transition-colors font-medium border border-rose-100 shadow-sm"
                        >
                          清空记录
                        </button>
                      </div>
                      
                      {history.map((record) => (
                        <div key={record.id} className="bg-white/60 backdrop-blur-md p-5 rounded-2xl border border-white/80 shadow-sm hover:shadow-md transition-shadow group">
                          <div className="flex justify-between items-start mb-4">
                            <div className="space-y-2 pr-4">
                              <p className="font-bold text-slate-700 text-sm line-clamp-2 leading-relaxed" title={record.prompt}>{record.prompt}</p>
                              <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-500">
                                <span className="bg-indigo-50/80 text-indigo-600 px-2.5 py-1 rounded-md border border-indigo-100/50">{record.model}</span>
                                <span className="bg-white/80 px-2.5 py-1 rounded-md border border-white">{record.size}</span>
                                <span className="flex items-center text-slate-400 ml-1">{record.timestamp}</span>
                              </div>
                            </div>
                            <button 
                              onClick={() => setHistory(history.filter(h => h.id !== record.id))}
                              className="text-slate-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity bg-white p-2 rounded-xl shadow-sm shrink-0 border border-white/80"
                              title="删除记录"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          
                          <div className="grid grid-cols-4 sm:grid-cols-5 xl:grid-cols-6 gap-3">
                            {record.images.map((url, i) => (
                              <a 
                                key={i}
                                href={url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="block relative rounded-xl overflow-hidden aspect-square border-2 border-white/80 shadow-sm hover:border-indigo-300 transition-colors bg-slate-50 group/img"
                              >
                                <img src={url} alt="History thumbnail" className="w-full h-full object-cover group-hover/img:scale-110 transition-transform duration-500" loading="lazy" />
                              </a>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              
            </div>
          </div>

        </div>
      </div>
      
    </div>
  );
}