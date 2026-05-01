import React, { useState, useRef } from 'react';
import { ArrowLeft, Upload, Link as LinkIcon, FileText, CheckCircle2, Loader2, Plus, X } from 'lucide-react';

interface UpdateDatabaseProps {
  onBack: () => void;
}

export default function UpdateDatabase({ onBack }: UpdateDatabaseProps) {
  const [dataType, setDataType] = useState<'File' | 'URL'>('File');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    }
    // reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const addUrl = () => {
    if (url.trim() && !urls.includes(url.trim())) {
      setUrls(prev => [...prev, url.trim()]);
      setUrl('');
    }
  };

  const removeUrl = (index: number) => {
    setUrls(prev => prev.filter((_, i) => i !== index));
  };

  const handleUrlKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addUrl();
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
        formData.append('title', title.trim() || 'Uploaded Document');
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
      
      // Reset form on success
      setFiles([]);
      setUrls([]);
      setTitle('');
      setUrl('');
      
    } catch (err: any) {
      console.error('Upload error:', err);
      setStatusMessage({ text: err.message || 'An error occurred during update.', type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#F3F4F6] sm:p-6 font-sans flex sm:items-center sm:justify-center">
      <div className="w-full max-w-4xl h-[100dvh] sm:h-[85vh] bg-[#D6D6D6] sm:rounded-[3rem] shadow-none sm:shadow-lg flex flex-col overflow-hidden relative">
        
        {/* Header */}
        <div className="flex items-center p-6 sm:p-8 shrink-0">
          <button 
            onClick={onBack}
            className="p-2 hover:bg-black/5 rounded-full transition-colors mr-4"
          >
            <ArrowLeft size={32} strokeWidth={2.5} className="text-black" />
          </button>
          <h1 className="text-3xl sm:text-4xl font-medium text-black tracking-tight mx-auto pr-12">
            Update Database
          </h1>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto px-8 sm:px-12 pb-24">
          
          <div className="space-y-8 max-w-2xl mx-auto mt-4">
            
            {/* Type of Data Dropdown */}
            <div className="space-y-3">
              <label className="block text-2xl font-medium text-black">
                Type of data
              </label>
              <div className="relative">
                <select
                  value={dataType}
                  onChange={(e) => setDataType(e.target.value as 'File' | 'URL')}
                  className="w-full appearance-none bg-[#7D7881] text-white text-lg rounded-full px-6 py-3 outline-none cursor-pointer focus:ring-2 focus:ring-black/20"
                >
                  <option value="File">File</option>
                  <option value="URL">URL</option>
                </select>
                <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </div>
              </div>
            </div>

            {/* Dynamic Content based on Type */}
            {dataType === 'File' ? (
              <>
                {/* Title Input */}
                <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <label className="block text-2xl font-medium text-black">
                    Title
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-[#7D7881] text-white placeholder-white/50 text-lg rounded-full px-6 py-3 outline-none focus:ring-2 focus:ring-black/20"
                  />
                </div>

                {/* File Upload Area */}
                <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-bottom-2 duration-300 delay-75">
                  <h2 className="text-2xl font-medium text-black">
                    Upload your file
                  </h2>
                  
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
                      className="inline-flex items-center gap-2 bg-[#B8B8B8] hover:bg-[#A8A8A8] text-black px-4 py-1.5 rounded-full text-sm font-medium transition-colors"
                    >
                      <Plus size={16} />
                      Upload files
                    </button>
                  </div>

                  {/* File List */}
                  {files.length > 0 && (
                    <div className="space-y-3 mt-4">
                      {files.map((file, idx) => (
                        <div key={idx} className="flex items-center gap-3 bg-white/30 px-4 py-2 rounded-xl group w-max">
                          <FileText className="text-red-500" size={24} />
                          <span className="text-black font-medium text-sm">{file.name}</span>
                          <button 
                            onClick={() => removeFile(idx)}
                            className="ml-2 p-1 text-black/50 hover:text-black hover:bg-black/10 rounded-full opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* URL Input */}
                <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <label className="block text-2xl font-medium text-black">
                    URL
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      onKeyDown={handleUrlKeyDown}
                      placeholder="https://..."
                      className="flex-1 bg-[#7D7881] text-white placeholder-white/50 text-lg rounded-full px-6 py-3 outline-none focus:ring-2 focus:ring-black/20"
                    />
                    <button 
                      onClick={addUrl}
                      disabled={!url.trim()}
                      className="bg-[#7D7881] hover:bg-[#6D6871] text-white px-6 rounded-full font-medium transition-colors disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>

                  {/* URL List */}
                  {urls.length > 0 && (
                    <div className="space-y-2 mt-6">
                      {urls.map((u, idx) => (
                        <div key={idx} className="flex items-center gap-3 px-2 group">
                          <LinkIcon className="text-black/70" size={18} />
                          <span className="text-black font-medium text-[15px] truncate max-w-[80%]">
                            {u}
                          </span>
                          <button 
                            onClick={() => removeUrl(idx)}
                            className="ml-auto p-1 text-black/50 hover:text-red-500 hover:bg-black/5 rounded-full transition-colors"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Status Message */}
            {statusMessage && (
              <div className={`p-4 rounded-xl flex items-start gap-3 mt-6 ${
                statusMessage.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}>
                {statusMessage.type === 'success' ? <CheckCircle2 className="shrink-0 mt-0.5" size={18} /> : null}
                <p className="text-sm font-medium">{statusMessage.text}</p>
              </div>
            )}

          </div>
        </div>

        {/* Bottom Bar with Done Button */}
        <div className="absolute bottom-0 left-0 right-0 p-8 flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || (dataType === 'File' && files.length === 0) || (dataType === 'URL' && urls.length === 0)}
            className="bg-[#7D7881] hover:bg-[#6D6871] text-white px-10 py-3 rounded-full text-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={24} className="animate-spin" />
                Processing...
              </>
            ) : (
              'Done'
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
