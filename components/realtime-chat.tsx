'use client';

import React, {
  memo,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useLayoutEffect,
  useDeferredValue,
  useRef,
} from 'react';

import { ChatMessageItem } from '@/components/chat-message';
import { useChatScroll } from '@/hooks/use-chat-scroll';
import { type ChatMessage, useRealtimeChat } from '@/hooks/use-realtime-chat';
import { Button } from '@/components/ui/button';
import { Send, Square, ChevronDown } from 'lucide-react';
// import { GoogleGenerativeAI } from '@google/generative-ai';

// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
// const genAI = new GoogleGenerativeAI('AIzaSyAUsT52YsaY6hYaA6u3huKkUaa25xGE9I8');

interface jsonCodeType {
  outputObject: {
    intent: string;
    html: string;
    jsonFormatOfHtml: object;
  };
}

// async function autoTransform(input: string): Promise<string> {
//   const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

//   const prompt = `
// You are a transformer.
// You will receive arbitrary input (JSON, lists, or free text).
// Step 1: Detect the correct transformation intent.
//   - Names and emails → transformUserData
//   - Links with labels and urls → transformContactLinks
//   - Other structured data → invent a sensible intent.
// Step 2: Output valid JSON code:
//   - Always declare: { outputObject: { intent: "<detectedIntent>", output: "<detectedOutput>" } }
//   - Use camelCase keys
//   - Output only JSON code
//   - Do not use \`\`\` fences
//   - Do not include TypeScript types or annotations

// Input:
// ${input}
// `;

//   const result = await model.generateContent(prompt);
//   return result.response.text();
// }

function removeJsonFences(text: string) {
  let cleaned = text.trim();

  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7).trimStart(); // remove ```json
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3).trimEnd(); // remove ```
  }

  return cleaned;
}

interface RealtimeChatProps {
  roomName: string;
  username: string;
  isPrivateChat: boolean;
  onMessage?: (messages: ChatMessage[]) => void;
  messages?: ChatMessage[];
}

/** Tap friendly quick suggestions that submit immediately */
function QuickSuggestions({
  onSelect,
  disabled,
  suggestions = [],
}: {
  onSelect: (text: string) => void;
  disabled: boolean;
  suggestions?: string[];
}) {
  return (
    <div className='bg-background px-4 pt-3 pb-4'>
      <div className='mb-2 text-xs font-medium text-muted-foreground'>
        Suggestions
      </div>
      <div className='grid grid-cols-1 md:grid-cols-2 gap-2'>
        {suggestions.map((text, i) => (
          <Button
            key={i}
            type='button'
            variant='secondary'
            className='h-auto justify-start text-left text-lg md:text-base py-3 px-3'
            disabled={disabled}
            aria-label={`Suggestion: ${text}`}
            onClick={() => {
              if (!disabled) onSelect(text);
            }}
          >
            {text}
          </Button>
        ))}
      </div>
    </div>
  );
}

function ScrollToBottomFab({
  visible,
  onClick,
}: {
  visible: boolean;
  onClick: () => void;
}) {
  if (!visible) return null;
  return (
    <button
      type='button'
      onClick={onClick}
      aria-label='Scroll to bottom'
      className='fixed right-4 bottom-28 md:bottom-32 z-40 rounded-full border bg-background shadow-lg p-2 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-ring'
    >
      <ChevronDown className='size-5' />
    </button>
  );
}

const ChatRow = memo(function ChatRow({
  message,
  username,
  showHeader,
}: {
  message: ChatMessage;
  username: string;
  showHeader: boolean;
}) {
  return (
    <div className='animate-in fade-in slide-in-from-bottom-4 duration-300'>
      <ChatMessageItem
        message={message}
        isOwnMessage={message.user.name === username}
        showHeader={showHeader}
      />
    </div>
  );
});

/**
 * MessagesList
 * Important: the scroll container itself is not a flex box
 * We use an inner wrapper to align content to the bottom when short
 */
const MessagesList = memo(
  forwardRef<HTMLDivElement, { messages: ChatMessage[]; username: string }>(
    function MessagesList({ messages, username }, ref) {
      return (
        <div
          ref={ref}
          role='region'
          aria-label='Chat messages'
          className='relative min-h-0 overflow-y-auto overscroll-y-contain scroll-smooth'
        >
          <div className='grid min-h-full content-end gap-4 p-4'>
            <div className='space-y-1'>
              {messages.map((message, index) => {
                const prev = index > 0 ? messages[index - 1] : null;
                const showHeader =
                  !prev || prev.user.name !== message.user.name;
                return (
                  <ChatRow
                    key={message.id}
                    message={message}
                    username={username}
                    showHeader={showHeader}
                  />
                );
              })}
            </div>
          </div>
        </div>
      );
    },
  ),
);

function InputBar({
  disabled,
  onSend,
  isLoading,
  onStop,
}: {
  disabled: boolean;
  onSend: (text: string) => void;
  isLoading: boolean;
  onStop: () => void;
}) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const maxHeightRef = useRef<number | null>(null);
  const MAX_LINES = 6;

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    if (maxHeightRef.current == null) {
      const cs = window.getComputedStyle(el);
      const lh = parseFloat(cs.lineHeight || '0');
      const pt = parseFloat(cs.paddingTop || '0');
      const pb = parseFloat(cs.paddingBottom || '0');
      const bt = parseFloat(cs.borderTopWidth || '0');
      const bb = parseFloat(cs.borderBottomWidth || '0');
      maxHeightRef.current = Math.ceil(lh * MAX_LINES + pt + pb + bt + bb);
      el.style.maxHeight = `${maxHeightRef.current}px`;
    }

    el.style.height = 'auto';
    const cap = maxHeightRef.current!;
    const next = Math.min(el.scrollHeight, cap);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > cap ? 'auto' : 'hidden';
  }, [value]);

  const actuallySend = useCallback(() => {
    const text = value.trim();
    if (!text || disabled || isLoading) return;
    setValue('');
    onSend(text);
  }, [value, disabled, isLoading, onSend]);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      actuallySend();
    },
    [actuallySend],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        actuallySend();
      }
    },
    [actuallySend],
  );

  return (
    <form
      onSubmit={onSubmit}
      className='flex w-full items-center gap-2 border-t border-border bg-background p-4'
    >
      <textarea
        ref={textareaRef}
        rows={1}
        className='flex-1 resize-none rounded-xl border bg-background px-4 py-4 text-lg leading-relaxed md:text-base md:leading-snug placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder='Ask me anything'
        disabled={disabled || isLoading}
      />
      {isLoading ? (
        <Button className='rounded-full p-3' type='button' onClick={onStop}>
          <Square className='size-4' />
        </Button>
      ) : (
        !disabled &&
        value.trim() && (
          <Button
            className='rounded-full p-5'
            type='submit'
            disabled={disabled}
          >
            <Send className='size-5' />
          </Button>
        )
      )}
    </form>
  );
}

export const RealtimeChat = ({
  roomName,
  username,
  isPrivateChat,
  onMessage,
  messages: initialMessages = [],
}: RealtimeChatProps) => {
  // the scroll helper exposes a ref and an imperative scrollToBottom
  const { containerRef, scrollToBottom } = useChatScroll();

  const {
    messages: realtimeMessages,
    sendMessage,
    isConnected,
  } = useRealtimeChat({
    roomName,
    username,
  });

  const [sessionId] = useState(() => crypto.randomUUID());
  const [isResponding, setIsResponding] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const [isAtBottom, setIsAtBottom] = useState(true);
  const wasAtBottomRef = useRef(true);
  const prevLenRef = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const EPS = 24;
    const handleScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= EPS;
      setIsAtBottom(atBottom);
      wasAtBottomRef.current = atBottom;
    };

    handleScroll();
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [containerRef]);

  const allMessages = useMemo(() => {
    const merged = [...initialMessages, ...realtimeMessages];
    const seen = new Set<string>();
    const unique: ChatMessage[] = [];
    for (const m of merged) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      unique.push(m);
    }
    unique.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    return unique;
  }, [initialMessages, realtimeMessages]);

  const typingMessage = {
    id: '__typing__',
    content: '',
    user: { name: 'assistant' },
    createdAt: new Date().toISOString(),
    typing: true,
  };

  const allMessagesWithTyping = isResponding
    ? [...allMessages, typingMessage]
    : allMessages;

  const deferredMessages = useDeferredValue(allMessagesWithTyping);

  const chatProps = isPrivateChat
    ? {
        suggestions: [
          `View contact information`,
          `Send a meeting recap with next steps`,
          `Give me qr code`,
          // `Connect on LinkedIn with a personal note`,
          // `Share an intro kit for your team`,
        ],
        webhookUrl:
          'https://n8n.justinrunes.com/webhook/c19652de-1a8e-4771-9148-4e8903001956',
      }
    : {
        suggestions: [
          `View email, phone, booking link and save contact`,
          `Connect on LinkedIn`,
          `Give me a bio summary of Justin`,
          `Get booking link`,
        ],
        webhookUrl:
          'https://n8n.justinrunes.com/webhook/5d983fb1-81cc-468a-97b1-bd143b1f5567',
      };

  useEffect(() => {
    if (onMessage) onMessage(allMessages);
  }, [allMessages, onMessage]);

  useEffect(() => {
    const len = deferredMessages.length;
    const grew = len > prevLenRef.current;
    prevLenRef.current = len;
    if (grew && wasAtBottomRef.current) {
      scrollToBottom();
    }
  }, [deferredMessages, scrollToBottom]);

  useEffect(() => {
    if (isResponding) scrollToBottom();
  }, [isResponding, scrollToBottom]);

  const onSend = useCallback(
    (text: string) => {
      if (!text.trim() || !isConnected) return;
      wasAtBottomRef.current = true;

      void sendMessage(text);

      const controller = new AbortController();
      abortRef.current = controller;
      setIsResponding(true);

      void fetch(chatProps.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text, sessionId }),
        signal: controller.signal,
      })
        .then(async (response) => {
          // Check if the HTTP request was successful (e.g., status 200-299)
          if (!response.ok) {
            // Try to get more error details from the response body
            const errorBody = await response
              .text()
              .catch(() => 'Could not read error body.');
            throw new Error(
              `HTTP error! status: ${response.status}, body: ${errorBody}`,
            );
          }

          // Check for an empty response body before trying to parse JSON
          const responseText = await response.text();
          if (!responseText) {
            // The response was successful but empty. This is not an error,
            // but there's no data to process.
            return null;
          }

          return JSON.parse(responseText);
        })
        .then((data) => {
          if (data?.output) {
            let messageOutput = '';

            console.log(data.output);

            let parsed;
            try {
              parsed = JSON.parse(removeJsonFences(data.output));
            } catch {
              parsed = {
                outputObject: {
                  intent: 'rawText',
                  html: data.output,
                  jsonFormatOfHtml: {},
                },
              };
            }

            const jsonConverted: jsonCodeType = parsed;
            const intent = jsonConverted.outputObject.intent;

            switch (intent) {
              case 'transformUserData':
                messageOutput = `User data detected:`;
                console.log(jsonConverted.outputObject.jsonFormatOfHtml);
                break;

              case 'transformContactLinks':
                messageOutput = `Contact links detected:`;
                console.log(jsonConverted.outputObject.jsonFormatOfHtml);
                // handle links array here
                break;

              case 'transformProducts':
                messageOutput = `Products detected:`;
                console.log(jsonConverted.outputObject.jsonFormatOfHtml);
                // handle products here
                break;

              default:
                messageOutput = jsonConverted.outputObject.html;
                console.log(jsonConverted.outputObject);
                break;
            }

            void sendMessage(messageOutput, 'assistant');
            // autoTransform(data.output).then((jsonCode: string) => {

            // });
          }
        })
        .catch((err) => {
          if ((err as Error).name !== 'AbortError') {
            console.error('Failed to fetch chat response:', err);
          }
        })
        .finally(() => {
          setIsResponding(false);
        });
    },
    [isConnected, sendMessage, chatProps.webhookUrl, sessionId],
  );

  const onStop = useCallback(() => {
    abortRef.current?.abort();
    setIsResponding(false);
  }, []);

  return (
    <div className='relative grid h-dvh min-h-0 w-full grid-rows-[1fr_auto_auto] bg-background text-foreground antialiased'>
      <ScrollToBottomFab
        visible={!isAtBottom}
        onClick={() => {
          wasAtBottomRef.current = true;
          scrollToBottom();
        }}
      />

      {/* Row 1: scrollable messages */}
      <MessagesList
        ref={containerRef}
        messages={deferredMessages}
        username={username}
      />

      {/* Row 2: suggestions */}
      {deferredMessages.length === 0 && (
        <QuickSuggestions
          suggestions={chatProps.suggestions}
          onSelect={onSend}
          disabled={!isConnected || isResponding}
        />
      )}

      {/* Row 3: composer */}
      <InputBar
        disabled={!isConnected}
        onSend={onSend}
        isLoading={isResponding}
        onStop={onStop}
      />
    </div>
  );
};
