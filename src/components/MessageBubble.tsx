import type { Message } from '@/types';

interface Props {
  message: Message;
}

export default function MessageBubble({ message }: Props) {
  const isCustomer = message.role === 'CUSTOMER';
  return (
    <div className={`flex items-start gap-3 ${isCustomer ? '' : 'flex-row-reverse'}`}>
      <span className="text-2xl flex-shrink-0">{isCustomer ? '🤖' : '👤'}</span>
      <div
        className={`rounded-2xl px-4 py-3 max-w-[80%] ${
          isCustomer
            ? 'bg-slate-700/60 border border-slate-600 rounded-tl-none'
            : 'bg-blue-600/30 border border-blue-800/50 rounded-tr-none'
        }`}
      >
        <p className="text-white text-sm whitespace-pre-wrap">{message.content}</p>
        <p className="text-xs text-slate-500 mt-1">{isCustomer ? 'Virtual Customer' : 'You'}</p>
      </div>
    </div>
  );
}
