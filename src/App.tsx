import React, { useState, useRef, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { Send, Bot, User, Loader2, Sparkles, ThumbsUp, ThumbsDown, ChevronUp } from 'lucide-react';
import { Scrollbars } from 'react-custom-scrollbars-2';
import { Analytics } from '@vercel/analytics/react';

export default function App() {
  const [messages, setMessages] = useState<{role: string, text: string, isError?: boolean, feedback?: 'up' | 'down', generationTime?: string}>([
    { 
      role: 'model', 
      text: "Hello! How can i help you today?" 
    }
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState("Gemini 2.5 Flash Lite");
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const faqScrollbarRef = useRef<Scrollbars>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target as Node)) {
        setIsModelMenuOpen(false);
      }
    };
    if (isModelMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isModelMenuOpen]);
  const suggestions = [
    "What if my courier did not pick up?",
    "What is Delyva?",
    "How to top up?",
    "How COD works?",
    "Track my parcel",
    "How to integrate API?",
    "What are the delivery rates?",
    "How to cancel a shipment?",
    "Where is my invoice?"
  ];

  // Auto-scroll to the bottom of the chat
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const getOrSetSessionId = () => {
    let sid = sessionStorage.getItem('chat_session_id');
    if (!sid) {
      sid = crypto.randomUUID();
      sessionStorage.setItem('chat_session_id', sid);
    }
    return sid;
  };

  // Load chat history on mount
  useEffect(() => {
    if (!db) return;
    const loadHistory = async () => {
      try {
        const docRef = doc(db, 'sessions', getOrSetSessionId());
        const snap = await getDoc(docRef);
        if (snap.exists() && snap.data().history) {
          setMessages(snap.data().history);
        }
      } catch (e) {
        console.error("Firebase history load error:", e);
      }
    };
    loadHistory();
  }, []);

  // Save chat history automatically when messages change
  useEffect(() => {
    if (!db || messages.length <= 1) return;
    const saveHistory = async () => {
      try {
        const docRef = doc(db, 'sessions', getOrSetSessionId());
        await setDoc(docRef, { 
          history: messages, 
          updatedAt: new Date().toISOString() 
        }, { merge: true });
      } catch (e) {
        console.error("Firebase history save error:", e);
      }
    };
    saveHistory();
  }, [messages]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  useEffect(() => {
    const scrollbars = faqScrollbarRef.current;
    if (!scrollbars) return;
    // @ts-ignore - react-custom-scrollbars-2 view ref
    const view = scrollbars.view;
    if (!view) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        view.scrollLeft += e.deltaY;
      }
    };
    view.addEventListener('wheel', handleWheel, { passive: false });
    return () => view.removeEventListener('wheel', handleWheel);
  }, []);

  // Call Backend RAG API natively
  const generateResponse = async (userText: string) => {
    setIsLoading(true);

    const backendHistory = messages.map(msg => ({
      role: msg.role === 'model' ? 'model' : 'user',
      parts: [{ text: msg.text }]
    }));
    
    backendHistory.push({
      role: 'user',
      parts: [{ text: userText }]
    });

    try {
      const startTime = performance.now();
      
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          history: backendHistory,
          selectedModel: selectedModel,
          inputValue: userText
        })
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }
      
      // Real-time Text Streaming parser
      const reader = response.body?.getReader();
      const decoder = new TextDecoder("utf-8");
      
      let botReply = "";
      setMessages(prev => [...prev, { role: 'model', text: "" }]);

      while (reader) {
        const { value, done } = await reader.read();
        if (done) break;
        
        botReply += decoder.decode(value, { stream: true });
        
        setMessages(prev => {
          const newArray = [...prev];
          newArray[newArray.length - 1] = { role: 'model', text: botReply };
          return newArray;
        });
      }

      const endTime = performance.now();
      const elapsedTime = ((endTime - startTime) / 1000).toFixed(1);

      if (botReply) {
        setMessages(prev => {
          const newArray = [...prev];
          newArray[newArray.length - 1] = { role: 'model', text: botReply, generationTime: elapsedTime };
          return newArray;
        });
      } else {
        throw new Error("Received an empty or malformed response from the AI.");
      }

    } catch (err: any) {
      console.error(err);
      
      let errorMessage = "I'm sorry, I encountered an error while trying to generate a response. Please try again later.";
      
      // Specifically catch rate limit or overloaded model errors
      if (err?.message?.includes("429") || err?.status === 429 || err?.message?.includes("503") || err?.status === 503) {
        errorMessage = "You've hit the limit or the model is overloaded! Please switch to another model.";
      }

      setMessages(prev => {
        // Find if we generated an empty string we should overwrite, otherwise append
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.role === 'model' && lastMsg.text === "") {
           const newArray = [...prev];
           newArray[newArray.length - 1] = { role: 'model', text: errorMessage, isError: true } as any;
           return newArray;
        }
        return [...prev, { role: 'model', text: errorMessage, isError: true } as any];
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputValue.trim() || isLoading) return;

    const userText = inputValue.trim();
    setMessages(prev => [...prev, { role: 'user', text: userText }]);
    setInputValue("");
    generateResponse(userText);
  };

  const handleSuggestionClick = (text: string) => {
    setMessages(prev => [...prev, { role: 'user', text }]);
    generateResponse(text);
  };

  const handleFeedback = (idx: number, type: 'up' | 'down') => {
    setMessages(prev => prev.map((msg, i) => 
      i === idx ? { ...msg, feedback: msg.feedback === type ? undefined : type } : msg
    ));
  };

  // Simple Markdown Renderer for chat bubbles
  const renderMessageText = (text: string) => {
    // Basic formatting: bold and links
    let formattedText = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    formattedText = formattedText.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="text-blue-600 underline font-medium hover:text-blue-800 transition-colors">$1</a>');
    
    return formattedText.split('\n').map((line, i) => (
      <p 
        key={i} 
        dangerouslySetInnerHTML={{ __html: line || '<br/>' }} 
        className={line ? "mb-1.5 last:mb-0" : ""}
      />
    ));
  };

  // --- UI: Chat Screen ---
  return (
    <div className="min-h-[100dvh] bg-[#F3F4F6] sm:p-6 font-sans flex sm:items-center sm:justify-center">
      <div className="w-full max-w-4xl h-[100dvh] sm:h-[85vh] bg-white sm:rounded-[2rem] shadow-none sm:shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)] flex flex-col overflow-hidden border-none sm:border border-slate-200/60 relative">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-700 to-blue-500 text-white p-3 sm:p-4 flex items-center justify-between shrink-0 shadow-sm z-10 relative overflow-hidden">
          {/* Decorative background elements */}
          <div className="absolute top-0 right-0 -mt-10 -mr-10 w-40 h-40 bg-white opacity-10 rounded-full blur-2xl pointer-events-none"></div>
          <div className="absolute bottom-0 left-0 -mb-10 -ml-10 w-32 h-32 bg-blue-900 opacity-20 rounded-full blur-xl pointer-events-none"></div>
          
          <div className="flex items-center gap-3 relative z-10">
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-md border border-white/20 shadow-inner">
              <Bot size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Delyva Assistant</h1>
              <div className="flex items-center gap-1.5 text-blue-100 text-xs mt-0.5 font-medium">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400"></span>
                </span>
                Online
              </div>
            </div>
          </div>
        </div>

        {/* Chat Area */}
        <Scrollbars
          autoHide
          autoHideTimeout={1000}
          autoHideDuration={500}
          style={{ flex: 1, backgroundColor: '#F9FAFB' }}
          renderThumbVertical={props => <div {...props} style={{ ...props.style, backgroundColor: '#cbd5e1', borderRadius: '10px', width: '4px' }} />}
          renderTrackVertical={props => <div {...props} className="custom-track-vertical" style={{ ...props.style, right: 0, top: 0, width: '4px' }} />}
        >
          <div className="p-5 sm:p-8 pb-32 sm:pb-40 space-y-8 scroll-smooth">
            {messages.map((msg, idx) => {
            const isUser = msg.role === 'user';
            return (
              <div key={idx} className={`flex ${isUser ? 'justify-end' : 'justify-start'} gap-3 sm:gap-4 max-w-full group`}>
                {!isUser && (
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-white flex items-center justify-center shrink-0 mt-1 shadow-md ring-4 ring-white">
                    <Bot size={18} />
                  </div>
                )}
                
                <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-[85%] sm:max-w-[75%]`}>
                  <div 
                    className={`
                      px-5 py-4 text-[15px] leading-relaxed shadow-sm transition-all
                      ${isUser 
                        ? 'bg-blue-600 text-white rounded-2xl rounded-tr-sm shadow-blue-600/20' 
                        : (msg as any).isError 
                          ? 'bg-red-50 text-red-800 border border-red-100 rounded-2xl rounded-tl-sm' 
                          : 'bg-white text-slate-700 border border-slate-200/60 rounded-2xl rounded-tl-sm hover:shadow-md'
                      }
                    `}
                  >
                    {renderMessageText(msg.text)}
                  </div>
                  
                  {!isUser && (
                    <div className="flex w-full justify-between items-start mt-0.5 px-0.5">
                      <div className={`flex gap-2 transition-opacity ${msg.feedback ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 text-slate-400'}`}>
                        {idx !== 0 && !(msg as any).isError && (
                          <>
                            <button 
                              onClick={() => handleFeedback(idx, 'up')}
                              className={`group/btn relative w-8 h-8 flex items-center justify-center rounded-md transition-colors hover:bg-slate-100 ${msg.feedback === 'up' ? 'text-slate-700' : 'text-slate-500 hover:text-slate-600'}`}
                            >
                              <div className="relative w-4 h-4">
                                <ThumbsUp size={16} className={`absolute inset-0 transition-opacity ${msg.feedback === 'up' ? 'opacity-100 fill-slate-300 text-slate-300' : 'opacity-0'}`} />
                                <ThumbsUp size={16} className="absolute inset-0 fill-none" />
                              </div>
                              <span className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-slate-800 text-white text-[11px] font-medium rounded opacity-0 group-hover/btn:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                                relevant
                              </span>
                            </button>
                            <button 
                              onClick={() => handleFeedback(idx, 'down')}
                              className={`group/btn relative w-8 h-8 flex items-center justify-center rounded-md transition-colors hover:bg-slate-100 ${msg.feedback === 'down' ? 'text-slate-700' : 'text-slate-500 hover:text-slate-600'}`}
                            >
                              <div className="relative w-4 h-4">
                                <ThumbsDown size={16} className={`absolute inset-0 transition-opacity ${msg.feedback === 'down' ? 'opacity-100 fill-slate-300 text-slate-300' : 'opacity-0'}`} />
                                <ThumbsDown size={16} className="absolute inset-0 fill-none" />
                              </div>
                              <span className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-slate-800 text-white text-[11px] font-medium rounded opacity-0 group-hover/btn:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                                not relevant
                              </span>
                            </button>
                          </>
                        )}
                      </div>

                      {msg.generationTime && (
                        <span className="text-[12px] text-slate-400/80 font-medium whitespace-nowrap pt-1 pr-1">
                          {msg.generationTime}s
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          
          {isLoading && (
            <div className="flex justify-start gap-3 sm:gap-4 animate-in fade-in duration-300">
              <div className="relative w-9 h-9 mt-1 shrink-0">
                {/* Spinning circle outside the bot icon */}
                <div className="absolute inset-0 rounded-full border-[3px] border-slate-200 border-t-blue-600 animate-spin"></div>
                <div className="absolute inset-[3px] rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-white flex items-center justify-center shadow-sm">
                  <Bot size={14} />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} className="h-4" />
          </div>
        </Scrollbars>

        {/* Floating Suggestions & Input Area Container */}
        <div className="absolute bottom-0 left-0 right-0 shrink-0 z-20 pointer-events-none">
          
          {/* Floating FAQ */}
          <div className="w-full px-4 sm:px-8 pb-0 pt-2 pointer-events-auto translate-y-[5px] [mask-image:linear-gradient(to_right,black_85%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_right,black_85%,transparent_100%)]">
            <Scrollbars
              ref={faqScrollbarRef}
              autoHide
              autoHideTimeout={1000}
              autoHideDuration={500}
              style={{ width: '100%', height: 50 }}
              renderThumbHorizontal={props => <div {...props} style={{ ...props.style, backgroundColor: 'rgba(148, 163, 184, 0.4)', borderRadius: '10px', height: '5px' }} />}
              renderTrackHorizontal={props => <div {...props} style={{ ...props.style, bottom: 0, left: '5%', right: '5%', height: '5px' }} />}
            >
              <div className="flex gap-2 pr-12 sm:pr-24 pb-2 w-max">
                {suggestions.map((text, i) => (
                <button 
                  key={i}
                  onClick={() => handleSuggestionClick(text)}
                  disabled={isLoading}
                  className="bg-white/60 backdrop-blur-md hover:bg-white/80 text-slate-700 border border-white/40 shadow-sm px-4 py-2 rounded-full whitespace-nowrap text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:text-blue-600 hover:border-blue-300 hover:shadow"
                >
                  {text}
                </button>
              ))}
              </div>
            </Scrollbars>
          </div>

          {/* Input Area */}
          <div className="p-4 sm:p-6 pt-0 pointer-events-auto">
            <form 
              onSubmit={handleSendMessage}
              className="relative flex items-end gap-2 bg-white/60 backdrop-blur-md border border-white/40 rounded-3xl p-1.5 focus-within:ring-4 focus-within:ring-blue-500/10 focus-within:border-blue-400 transition-all shadow-sm"
            >
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder="Ask a question about DelyvaNow..."
                className="flex-1 bg-transparent border-none focus:ring-0 resize-none py-2 px-4 text-[15px] text-slate-700 min-h-[40px] max-h-[120px] placeholder:text-slate-500 outline-none"
                rows={1}
              />
              
              {/* Model Menu Popup within its own relative ref container */}
              <div ref={modelMenuRef} className="relative flex items-center h-full">
                {isModelMenuOpen && (
                  <div className="absolute bottom-full right-0 mb-2 w-64 bg-[#6b6b6b] text-white rounded-2xl shadow-xl z-50 animate-in fade-in slide-in-from-bottom-2 duration-200 p-2">
                    <div className="flex flex-col gap-1">
                      <button 
                        type="button"
                        onClick={() => { setSelectedModel("Gemini 2.5 Flash Lite"); setIsModelMenuOpen(false); }}
                        className={`flex flex-col items-start px-3 py-2.5 transition-colors text-left rounded-xl ${selectedModel === "Gemini 2.5 Flash Lite" ? "bg-black/20" : "hover:bg-white/10"}`}
                      >
                        <span className="text-[15px] font-medium leading-tight">Gemini 2.5 Flash Lite</span>
                        <span className="text-[13px] text-white/70 leading-tight mt-0.5">Recommended</span>
                      </button>
                      <button 
                        type="button"
                        onClick={() => { setSelectedModel("Gemini 3.1 Flash Lite"); setIsModelMenuOpen(false); }}
                        className={`flex flex-col items-start px-3 py-2.5 transition-colors text-left rounded-xl ${selectedModel === "Gemini 3.1 Flash Lite" ? "bg-black/20" : "hover:bg-white/10"}`}
                      >
                        <span className="text-[15px] font-medium leading-tight">Gemini 3.1 Flash Lite</span>
                        <span className="text-[13px] text-white/70 leading-tight mt-0.5">Second option</span>
                      </button>
                      <button 
                        type="button"
                        onClick={() => { setSelectedModel("Gemma 4 31B"); setIsModelMenuOpen(false); }}
                        className={`flex flex-col items-start px-3 py-2.5 transition-colors text-left rounded-xl ${selectedModel === "Gemma 4 31B" ? "bg-black/20" : "hover:bg-white/10"}`}
                      >
                        <span className="text-[15px] font-medium leading-tight">Gemma 4 31B</span>
                        <span className="text-[13px] text-white/70 leading-tight mt-0.5">Third option</span>
                      </button>
                    </div>
                  </div>
                )}

                <button 
                  type="button" 
                  onClick={() => setIsModelMenuOpen(!isModelMenuOpen)}
                  className="w-9 h-9 mb-0.5 flex items-center justify-center text-slate-500 hover:text-blue-600 hover:bg-blue-50/50 rounded-full transition-colors shrink-0"
                >
                  <ChevronUp size={20} />
                </button>
              </div>
              <button
                type="submit"
                disabled={!inputValue.trim() || isLoading}
                className={`
                  w-9 h-9 mb-0.5 rounded-full flex items-center justify-center transition-all duration-200 shrink-0
                  ${(!inputValue.trim() || isLoading)
                    ? 'bg-slate-200/50 text-slate-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg hover:-translate-y-0.5'
                  }
                `}
              >
                <Send size={16} />
              </button>
            </form>
          </div>
        </div>

      </div>
      <Analytics />
    </div>
  );
}
