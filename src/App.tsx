import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2 } from 'lucide-react';

export default function App() {
  const [messages, setMessages] = useState([
    { 
      role: 'model', 
      text: "Hello! I'm the DelyvaNow support assistant. I've successfully loaded the knowledge base. How can I help you today?" 
    }
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  
  const messagesEndRef = useRef(null);

  // Auto-scroll to the bottom of the chat
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  // Call Gemini API
  const generateResponse = async (userText: string) => {
    setIsLoading(true);

    // Prepare message history for Gemini
    const geminiHistory = messages.map(msg => ({
      role: msg.role === 'model' ? 'model' : 'user',
      parts: [{ text: msg.text }]
    }));

    // Add the new user message
    geminiHistory.push({
      role: 'user',
      parts: [{ text: userText }]
    });

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history: geminiHistory })
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || "Server responded with an error");
      }

      const botReply = data.text;

      if (botReply) {
        setMessages(prev => [...prev, { role: 'model', text: botReply }]);
      } else {
        throw new Error("Received an empty or malformed response from the AI.");
      }

    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { 
        role: 'model', 
        text: "I'm sorry, I encountered an error while trying to generate a response. Please try again later.",
        isError: true
      } as any]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading) return;

    const userText = inputValue.trim();
    setMessages(prev => [...prev, { role: 'user', text: userText }]);
    setInputValue("");
    generateResponse(userText);
  };

  // Simple Markdown Renderer for chat bubbles
  const renderMessageText = (text: string) => {
    // Basic formatting: bold and links
    let formattedText = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    formattedText = formattedText.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="text-blue-600 underline font-medium hover:text-blue-800">$1</a>');
    
    return formattedText.split('\n').map((line, i) => (
      <p 
        key={i} 
        dangerouslySetInnerHTML={{ __html: line || '<br/>' }} 
        className={line ? "mb-1" : ""}
      />
    ));
  };

  // --- UI: Chat Screen ---
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-2 sm:p-4 font-sans">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200" style={{ height: '85vh' }}>
        
        {/* Header */}
        <div className="bg-blue-600 text-white p-4 sm:p-5 flex items-center gap-3 shrink-0 shadow-sm z-10">
          <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm">
            <Bot size={24} />
          </div>
          <div>
            <h1 className="text-lg font-bold">Delyva Assistant</h1>
            <div className="flex items-center gap-1.5 text-blue-100 text-xs mt-0.5">
              <span className="w-2 h-2 bg-green-400 rounded-full"></span>
              Online
            </div>
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-slate-50">
          {messages.map((msg, idx) => {
            const isUser = msg.role === 'user';
            return (
              <div key={idx} className={`flex ${isUser ? 'justify-end' : 'justify-start'} gap-3 max-w-full`}>
                {!isUser && (
                  <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0 mt-1">
                    <Bot size={18} />
                  </div>
                )}
                
                <div 
                  className={`
                    px-5 py-3.5 rounded-2xl max-w-[85%] sm:max-w-[75%] text-[15px] leading-relaxed shadow-sm
                    ${isUser 
                      ? 'bg-blue-600 text-white rounded-tr-sm' 
                      : (msg as any).isError 
                        ? 'bg-red-50 text-red-800 border border-red-100 rounded-tl-sm' 
                        : 'bg-white text-slate-800 border border-slate-100 rounded-tl-sm'
                    }
                  `}
                >
                  {renderMessageText(msg.text)}
                </div>

                {isUser && (
                  <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center shrink-0 mt-1">
                    <User size={18} />
                  </div>
                )}
              </div>
            );
          })}
          
          {isLoading && (
            <div className="flex justify-start gap-3">
               <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0 mt-1">
                  <Bot size={18} />
                </div>
              <div className="bg-white border border-slate-100 px-5 py-4 rounded-2xl rounded-tl-sm shadow-sm flex items-center gap-2">
                <Loader2 size={16} className="text-blue-600 animate-spin" />
                <span className="text-slate-500 text-sm font-medium">Analyzing knowledge base...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 bg-white border-t border-slate-100 shrink-0">
          <form 
            onSubmit={handleSendMessage}
            className="flex items-end gap-2 relative max-w-full"
          >
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage(e as any);
                }
              }}
              placeholder="Ask a question about DelyvaNow..."
              className="flex-1 resize-none bg-slate-50 border border-slate-200 rounded-2xl py-3 px-4 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 min-h-[52px] max-h-[120px] text-slate-700 text-[15px]"
              rows={1}
            />
            <button
              type="submit"
              disabled={!inputValue.trim() || isLoading}
              className={`
                p-3.5 rounded-full flex items-center justify-center transition-all shadow-sm
                ${(!inputValue.trim() || isLoading)
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white hover:shadow-md'
                }
              `}
            >
              <Send size={20} className={inputValue.trim() && !isLoading ? "ml-0.5" : ""} />
            </button>
          </form>
          <div className="text-center mt-2">
            <span className="text-[11px] text-slate-400">Powered by Gemini 2.5 Flash • strictly searches uploaded KB</span>
          </div>
        </div>

      </div>
    </div>
  );
}
