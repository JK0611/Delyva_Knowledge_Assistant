import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Upload, Link as LinkIcon, FileText, CheckCircle2, Loader2, Plus, X, History, Trash2 } from 'lucide-react';

interface UpdateDatabaseProps {
  onBack: () => void;
}

interface KBEntry {
  title: string;
  url: string;
  category: string;
  content: string;
}

export default function UpdateDatabase({ onBack }: UpdateDatabaseProps) {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [password, setPassword] = useState('');
  const [activeTab, setActiveTab] = useState<'upload' | 'history'>('upload');
  const [dataType, setDataType] = useState<'File' | 'URL'>('File');
  const [url, setUrl] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [recentUploads, setRecentUploads] = useState<KBEntry[]>([]);
  const [limitError, setLimitError] = useState<string | null>(null);
  const [isShaking, setIsShaking] = useState(false);
  const [showPassError, setShowPassError] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === '260426') {
      setIsAuthorized(true);
    } else {
      setShowPassError(true);
      setIsShaking(true);
      setTimeout(() => {
        setIsShaking(false);
        setShowPassError(false);
      }, 500);
    }
  };

  // Fetch history periodically for "immediate sync"
  useEffect(() => {
    if (isAuthorized) {
      fetchHistory();
      const interval = setInterval(fetchHistory, 5000);
      return () => clearInterval(interval);
    }
  }, [isAuthorized]);

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/kb-recent');
      if (res.ok) {
        const data = await res.json();
        setRecentUploads(data);
      }
    } catch (e) {
      console.error("Failed to fetch history:", e);
    }
  };

  const triggerLimitError = (msg: string) => {
    setLimitError(msg);
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 500);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files!);
      if (files.length + newFiles.length > 3) {
        triggerLimitError('Maximum 3 PDF files allowed per upload');
        return;
      }
      setLimitError(null);
      setFiles(prev => [...prev, ...newFiles]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
    setLimitError(null);
  };

  const addUrl = () => {
    if (urls.length >= 5) {
      triggerLimitError('Maximum 5 URLs allowed per upload');
      return;
    }
    if (url.trim() && !urls.includes(url.trim())) {
      setLimitError(null);
      setUrls(prev => [...prev, url.trim()]);
      setUrl('');
    }
  };

  const removeUrl = (index: number) => {
    setUrls(prev => prev.filter((_, i) => i !== index));
    setLimitError(null);
  };

  const handleUrlKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addUrl();
    }
  };

  const handleDeleteEntry = async (entry: KBEntry) => {
    if (!confirm(`Are you sure you want to remove "${entry.title}"?`)) return;
    
    try {
      const res = await fetch('/api/kb-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: entry.url, title: entry.title })
      });
      if (res.ok) {
        fetchHistory();
      }
    } catch (e) {
      console.error("Delete failed:", e);
    }
  };

  const handleSubmit = async () => {
    if (dataType === 'File' && files.length === 0) {
      setStatusMessage({ text: 'Please upload at least one file.', type: 'error' });
      return;
    }
    if (dataType === 'URL' && urls.length === 0) {
      setStatusMessage({ text: 'Please add at least one URL.', type: 'error' });
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      const formData = new FormData();
      formData.append('type', dataType.toLowerCase());
      
      if (dataType === 'File') {
        files.forEach(file => {
          formData.append('files', file);
        });
      } else {
        formData.append('urls', JSON.stringify(urls));
      }

      const response = await fetch('/api/update-kb', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server error: ${response.status}`);
      }

      setStatusMessage({ text: 'Database updated successfully!', type: 'success' });
      setFiles([]);
      setUrls([]);
      setUrl('');
      fetchHistory(); // Immediate sync after successful upload
      
    } catch (err: any) {
      console.error('Upload error:', err);
      setStatusMessage({ text: err.message || 'An error occurred during update.', type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const groupedUploads = React.useMemo(() => {
    const groups = new Map<string, { entry: KBEntry, count: number }>();
    recentUploads.forEach(entry => {
      const baseTitle = entry.title.replace(/ \[Part \d+\]$/, '');
      if (groups.has(baseTitle)) {
        groups.get(baseTitle)!.count++;
      } else {
        groups.set(baseTitle, { entry: { ...entry, title: baseTitle }, count: 1 });
      }
    });
    return Array.from(groups.values());
  }, [recentUploads]);

  return (
    <div className="min-h-[100dvh] bg-white sm:bg-[#F3F4F6] sm:p-6 font-sans flex sm:items-center sm:justify-center relative overflow-hidden">
      
      {/* Background Content (Blurred if not authorized) */}
      <div className={`w-full max-w-2xl h-[100dvh] sm:h-[600px] bg-white sm:rounded-[2rem] shadow-none sm:shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)] flex flex-col overflow-hidden border-none sm:border border-slate-200/60 transition-all duration-500 ${!isAuthorized ? 'blur-xl opacity-30 scale-95 pointer-events-none' : 'blur-0 opacity-100 scale-100'}`}>
        
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-700 to-blue-500 text-white p-4 sm:p-6 flex items-center shrink-0 shadow-sm z-10 relative overflow-hidden">
          <div className="absolute top-0 right-0 -mt-10 -mr-10 w-40 h-40 bg-white opacity-10 rounded-full blur-2xl pointer-events-none"></div>
          <div className="absolute bottom-0 left-0 -mb-10 -ml-10 w-32 h-32 bg-blue-900 opacity-20 rounded-full blur-xl pointer-events-none"></div>
          
          <button 
            onClick={onBack}
            className="relative z-10 p-2 hover:bg-white/20 rounded-full transition-colors mr-2"
          >
            <ArrowLeft size={24} strokeWidth={2.5} className="text-white" />
          </button>
          <div className="flex-1 relative z-10">
            <h1 className="text-xl font-bold tracking-tight">Update Database</h1>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="flex bg-slate-50 p-1 mx-4 sm:mx-12 mt-6 rounded-xl border border-slate-200/60 shrink-0">
          <button 
            onClick={() => setActiveTab('upload')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-lg transition-all ${
              activeTab === 'upload' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Upload size={16} />
            Upload DB
          </button>
          <button 
            onClick={() => setActiveTab('history')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-lg transition-all ${
              activeTab === 'history' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <History size={16} />
            Recent Uploads
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-12 pb-6">
          <div className="max-w-xl mx-auto mt-6">
            
            {/* Prominent Limit Error Alert */}
            {limitError && (
              <div className={`mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300 ${isShaking ? 'animate-shake' : ''}`}>
                <div className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center shrink-0">
                  <X size={14} className="text-white" />
                </div>
                <p className="text-red-700 text-xs font-bold leading-tight">
                  {limitError}
                </p>
              </div>
            )}

            {/* Status Message (Success/Submission Error) */}
            {statusMessage && (
              <div className={`mb-6 p-4 rounded-xl flex items-start gap-3 animate-in fade-in slide-in-from-top-4 duration-300 ${
                statusMessage.type === 'success' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-700 border border-red-100'
              }`}>
                {statusMessage.type === 'success' && <CheckCircle2 size={18} className="mt-0.5" />}
                <p className="text-sm font-medium">{statusMessage.text}</p>
              </div>
            )}

            {activeTab === 'upload' ? (
              <div className="space-y-6">
                {/* Type selection */}
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider ml-1">
                    Type of data
                  </label>
                  <div className="relative">
                    <select
                      value={dataType}
                      onChange={(e) => {
                        setDataType(e.target.value as 'File' | 'URL');
                        setLimitError(null);
                      }}
                      className="w-full appearance-none bg-white border border-slate-200 text-slate-700 text-base rounded-2xl px-5 py-3 outline-none cursor-pointer focus:border-blue-500 transition-all shadow-sm"
                    >
                      <option value="File">File</option>
                      <option value="URL">URL</option>
                    </select>
                    <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                        <polyline points="6 9 12 15 18 9"></polyline>
                      </svg>
                    </div>
                  </div>
                </div>

                {dataType === 'File' ? (
                  <div className="space-y-3 pt-2">
                    <div className="flex justify-between items-end">
                      <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider ml-1">
                        Upload your file
                      </h2>
                      <span className="text-[10px] text-slate-400 font-medium">Max 3 files</span>
                    </div>
                    
                    <div>
                      <input 
                        type="file" 
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        accept=".pdf"
                        multiple
                        className="hidden" 
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex items-center gap-2 bg-blue-50 hover:bg-blue-100 text-blue-700 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors border border-blue-100 shadow-sm"
                      >
                        <Plus size={16} />
                        Add PDFs
                      </button>
                    </div>

                    {files.length > 0 && (
                      <div className="mt-2 divide-y divide-slate-100 border rounded-xl px-3 bg-slate-50/50">
                        {files.map((file, idx) => (
                          <div key={idx} className="flex items-center gap-3 py-2">
                            <FileText size={14} className="text-red-500 shrink-0" />
                            <span className="text-slate-600 text-xs truncate flex-1">{file.name}</span>
                            <button onClick={() => removeFile(idx)} className="p-2 text-slate-400 hover:text-red-500 shrink-0">
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex justify-between items-end">
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider ml-1">
                        URL
                      </label>
                      <span className="text-[10px] text-slate-400 font-medium">Max 5 URLs</span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        onKeyDown={handleUrlKeyDown}
                        placeholder="https://example.com"
                        className="flex-1 min-w-0 bg-white border border-slate-200 text-slate-700 placeholder-slate-400 text-base rounded-2xl px-4 sm:px-5 py-3 outline-none focus:border-blue-500 transition-all shadow-sm"
                      />
                      <button 
                        onClick={addUrl}
                        disabled={!url.trim()}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-5 sm:px-6 rounded-2xl font-semibold transition-all shadow-md active:scale-95 shrink-0"
                      >
                        Add
                      </button>
                    </div>

                    {urls.length > 0 && (
                      <div className="mt-2 divide-y divide-slate-100 border rounded-xl px-3 bg-slate-50/50">
                        {urls.map((u, idx) => (
                          <div key={idx} className="flex items-center gap-3 py-2">
                            <LinkIcon size={12} className="text-blue-500 shrink-0" />
                            <span className="text-slate-600 text-xs truncate flex-1">{u}</span>
                            <button onClick={() => removeUrl(idx)} className="p-2 text-slate-400 hover:text-red-500 shrink-0">
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

              </div>
            ) : (
              <div className="space-y-4">
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider ml-1">
                  Recently Uploaded
                </h2>
                <div className="space-y-2">
                  {groupedUploads.length > 0 ? groupedUploads.map(({ entry, count }, idx) => (
                    <div key={idx} className="bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between group hover:border-blue-200 transition-colors">
                      <div className="flex-1 min-w-0 pr-4">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-slate-800 truncate">{entry.title}</h3>
                          {count > 1 && (
                            <span className="bg-blue-50 text-blue-600 text-[10px] px-1.5 py-0.5 rounded-md font-bold shrink-0">
                              {count} parts
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 truncate">{entry.url}</p>
                        <span className="inline-block mt-1 px-2 py-0.5 bg-slate-100 text-slate-500 text-[9px] font-bold rounded-md uppercase">
                          {entry.category}
                        </span>
                      </div>
                      <button 
                        onClick={() => handleDeleteEntry(entry)}
                        className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-100 sm:opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )) : (
                    <div className="text-center py-12">
                      <History className="mx-auto text-slate-200 mb-2" size={40} />
                      <p className="text-slate-400 text-sm">No recent uploads found.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Action */}
        {activeTab === 'upload' && (
          <div className="p-4 sm:p-8 pt-0 flex justify-end shrink-0 bg-white">
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || (dataType === 'File' && files.length === 0) || (dataType === 'URL' && urls.length === 0)}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white px-8 py-3.5 sm:py-3 rounded-2xl text-base font-semibold transition-all shadow-lg hover:shadow-blue-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Updating...
                </>
              ) : (
                <>
                  <CheckCircle2 size={18} />
                  Confirm Update
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Password Overlay Modal */}
      {!isAuthorized && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-6 animate-in fade-in duration-500">
          <div className="absolute inset-0 bg-slate-100/40 backdrop-blur-[2px]"></div>
          <div className={`w-full max-w-[320px] bg-white rounded-[1.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.15)] p-6 border border-slate-100 relative z-10 ${isShaking ? 'animate-shake border-red-200' : ''}`}>
            <div className="flex justify-center mb-4">
              <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center text-blue-500">
                <Upload size={24} />
              </div>
            </div>
            <h2 className="text-base font-bold text-slate-800 text-center mb-1">Authorization Required</h2>
            <p className="text-slate-400 text-center mb-6 text-[11px] font-medium leading-relaxed">Enter security code to manage database</p>
            
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••"
                autoFocus
                className={`w-full bg-slate-50/50 border ${showPassError ? 'border-red-400 bg-red-50/50' : 'border-slate-100'} text-slate-700 text-center text-base tracking-[0.3em] rounded-xl px-4 py-2.5 outline-none focus:border-blue-400 focus:bg-white transition-all`}
              />
              <div className="flex gap-2.5">
                <button type="button" onClick={onBack} className="flex-1 bg-slate-50 hover:bg-slate-100 text-slate-500 py-2.5 rounded-xl text-xs font-bold transition-all">Back</button>
                <button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl text-xs font-bold transition-all shadow-md">Confirm</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
