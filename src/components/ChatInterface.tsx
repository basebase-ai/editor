'use client';

import React, { useRef, useEffect, useState } from 'react';
import { 
  Stack, 
  ScrollArea, 
  TextInput, 
  ActionIcon, 
  Paper, 
  Text, 
  Box, 
  Loader,
  Group
} from '@mantine/core';
import { IconSend, IconPlayerStop } from '@tabler/icons-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ChatInterfaceProps {
  onCodeChange: () => void;
  repoUrl: string;
  githubToken: string;
}

export default function ChatInterface({ onCodeChange, repoUrl }: ChatInterfaceProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const stop = () => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
      setIsLoading(false);
    }
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInput(event.target.value);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!input.trim() || isLoading) return;
    
    const userInput = input;
    setInput('');
    
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userInput,
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    const controller = new AbortController();
    setAbortController(controller);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [...messages, userMessage].map(msg => ({
            role: msg.role,
            content: msg.content
          }))
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);

      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;

        if (value) {
          const chunk = decoder.decode(value);
          
          // AI SDK sends raw text chunks, append directly to message
          if (chunk.trim()) {
            setMessages(prev => prev.map(msg => 
              msg.id === assistantMessage.id 
                ? { ...msg, content: msg.content + chunk }
                : msg
            ));
            
            // Aggressive scroll after each chunk to ensure we stay at bottom during streaming
            scrollToBottom(true, 5);
          }
        }
      }

      onCodeChange();
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setIsLoading(false);
      setAbortController(null);
    }
  };

  // Auto-scroll function with improved reliability
  const scrollToBottom = (force = false, delay = 0) => {
    if (scrollAreaRef.current) {
      const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement;
      if (viewport) {
        const performScroll = () => {
          // Double requestAnimationFrame for more reliable timing with dynamic content
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              viewport.scrollTo({
                top: viewport.scrollHeight,
                behavior: force ? 'auto' : 'smooth'
              });
            });
          });
        };

        if (delay > 0) {
          setTimeout(performScroll, delay);
        } else {
          performScroll();
        }
      }
    }
  };

  // Auto-scroll when messages change
  useEffect(() => {
    if (messages.length > 0) {
      // Use immediate scroll for all messages, with a small delay to ensure content is rendered
      scrollToBottom(true, 10);
    }
  }, [messages]);

  // Additional scroll for streaming content
  useEffect(() => {
    if (isLoading && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.role === 'assistant') {
        // Scroll during streaming with immediate behavior
        scrollToBottom(true);
      }
    }
  }, [messages, isLoading]);

  // Enhanced markdown parsing function
  const parseInlineMarkdown = (text: string): React.ReactNode => {
    if (!text) return text;
    
    const parts: React.ReactNode[] = [];
    let currentIndex = 0;
    
    // Define patterns for inline markdown with non-overlapping approach
    const patterns = [
      { regex: /\*\*([^*]+)\*\*/g, component: (_match: string, content: string) => <Text component="span" fw={700}>{content}</Text> },
      { regex: /\*([^*]+)\*/g, component: (_match: string, content: string) => <Text component="span" fs="italic">{content}</Text> },
      { regex: /`([^`]+)`/g, component: (_match: string, content: string) => <Text component="span" ff="monospace" px={4} py={2} style={{ borderRadius: 3, backgroundColor: 'light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-6))', color: 'light-dark(var(--mantine-color-dark-9), var(--mantine-color-gray-0))' }}>{content}</Text> },
    ];
    
    // Find all matches across all patterns
    const allMatches: Array<{ start: number; end: number; element: React.ReactNode }> = [];
    
    patterns.forEach(pattern => {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match;
      while ((match = regex.exec(text)) !== null) {
        allMatches.push({
          start: match.index,
          end: match.index + match[0].length,
          element: pattern.component(match[0], match[1])
        });
      }
    });
    
    // Sort matches by start position and remove overlapping matches
    allMatches.sort((a, b) => a.start - b.start);
    
    // Filter out overlapping matches (keep the first one)
    const filteredMatches = allMatches.filter((match, index) => {
      if (index === 0) return true;
      const prevMatch = allMatches[index - 1];
      return match.start >= prevMatch.end;
    });
    
    // Process matches and build result
    filteredMatches.forEach((match, index) => {
      // Add text before this match
      if (match.start > currentIndex) {
        parts.push(text.slice(currentIndex, match.start));
      }
      
      // Add the formatted element
      parts.push(<React.Fragment key={`inline-${index}`}>{match.element}</React.Fragment>);
      currentIndex = match.end;
    });
    
    // Add remaining text
    if (currentIndex < text.length) {
      parts.push(text.slice(currentIndex));
    }
    
    return parts.length > 0 ? parts : text;
  };

  const formatMessage = (content: string) => {
    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let i = 0;
    
    while (i < lines.length) {
      const line = lines[i];
      
      // Handle code blocks
      if (line.startsWith('```')) {
        const language = line.slice(3).trim();
        const codeLines: string[] = [];
        i++; // Skip opening ```
        
        // Collect code lines until closing ```
        while (i < lines.length && !lines[i].startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        i++; // Skip closing ```
        
        elements.push(
          <Box key={`code-${elements.length}`} mb="md">
            <Text size="xs" c="dimmed" mb={2}>
              {language || 'code'}
            </Text>
            <Box
              p="sm"
              style={{
                borderRadius: '6px',
                fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
                fontSize: '13px',
                border: '1px solid var(--mantine-color-gray-4)',
                overflowX: 'auto',
                maxWidth: '100%',
                backgroundColor: 'light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-6))',
                color: 'light-dark(var(--mantine-color-gray-9), var(--mantine-color-gray-0))'
              }}
            >
              <pre style={{ 
                margin: 0, 
                whiteSpace: 'pre',
                color: 'inherit',
                wordWrap: 'break-word',
                overflowWrap: 'break-word'
              }}>
                {codeLines.join('\n')}
              </pre>
            </Box>
          </Box>
        );
        continue;
      }
      
      // Handle headers
      if (line.match(/^#{1,6}\s/)) {
        const level = line.match(/^(#{1,6})/)?.[1].length || 1;
        const headerText = line.replace(/^#{1,6}\s*/, '');
        const sizes = ['xl', 'lg', 'md', 'sm', 'sm', 'xs'] as const;
        const weights = [700, 600, 600, 500, 500, 500] as const;
        
        elements.push(
          <Text key={`header-${elements.length}`} size={sizes[level - 1]} fw={weights[level - 1]} mb="sm" mt={level === 1 ? "md" : "sm"} style={{ wordWrap: 'break-word', overflowWrap: 'break-word' }}>
            {parseInlineMarkdown(headerText)}
          </Text>
        );
      }
      // Tool progress indicators (lines with emojis like 🔍, 📁, etc.)
      else if (line.match(/^[🔍📁📝🔧🔎⚡🔄]\s/)) {
        elements.push(
          <Text key={`progress-${elements.length}`} size="sm" c="blue.6" fw={500} mb={1} style={{ fontStyle: 'italic', wordWrap: 'break-word', overflowWrap: 'break-word' }}>
            {parseInlineMarkdown(line)}
          </Text>
        );
      }
      // Tool result summaries (lines starting with "Found", "Read", "Updated", etc.)
      else if (line.match(/^(Found|Read|Updated|Created|Searched|Listed|✓|Edited|Wrote)\s/) || line.includes(' matches for ') || line.includes(' lines from ')) {
        elements.push(
          <Text key={`result-${elements.length}`} size="sm" c="green.7" fw={500} mb={1} style={{ wordWrap: 'break-word', overflowWrap: 'break-word' }}>
            {parseInlineMarkdown(line.startsWith('✓') ? line : line)}
          </Text>
        );
      }
      // List items with improved handling
      else if (line.match(/^[\s]*[\*\-\+]\s/)) {
        const indent = (line.match(/^(\s*)/)?.[1].length || 0) / 2; // Assume 2 spaces per indent level
        const listText = line.replace(/^[\s]*[\*\-\+]\s*/, '');
        
        elements.push(
          <Box key={`list-${elements.length}`} ml={indent * 16} mb={2} style={{ maxWidth: '100%' }}>
            <Text size="sm" style={{ display: 'flex', alignItems: 'flex-start' }}>
              <Text component="span" mr={8} style={{ flexShrink: 0 }}>•</Text>
              <Box style={{ wordWrap: 'break-word', overflowWrap: 'break-word', minWidth: 0, flex: 1 }}>{parseInlineMarkdown(listText)}</Box>
            </Text>
          </Box>
        );
      }
      // Numbered lists
      else if (line.match(/^[\s]*\d+\.\s/)) {
        const indent = (line.match(/^(\s*)/)?.[1].length || 0) / 2;
        const number = line.match(/^[\s]*(\d+)\./)?.[1] || '1';
        const listText = line.replace(/^[\s]*\d+\.\s*/, '');
        
        elements.push(
          <Box key={`numlist-${elements.length}`} ml={indent * 16} mb={2} style={{ maxWidth: '100%' }}>
            <Text size="sm" style={{ display: 'flex', alignItems: 'flex-start' }}>
              <Text component="span" mr={8} style={{ flexShrink: 0, minWidth: '20px' }}>{number}.</Text>
              <Box style={{ wordWrap: 'break-word', overflowWrap: 'break-word', minWidth: 0, flex: 1 }}>{parseInlineMarkdown(listText)}</Box>
            </Text>
          </Box>
        );
      }
      // Blockquotes
      else if (line.startsWith('> ')) {
        const quoteText = line.replace(/^>\s*/, '');
        elements.push(
          <Box key={`quote-${elements.length}`} mb="sm" pl="md" style={{ borderLeft: '3px solid var(--mantine-color-gray-4)', maxWidth: '100%' }}>
            <Text size="sm" c="dimmed" style={{ fontStyle: 'italic', wordWrap: 'break-word', overflowWrap: 'break-word' }}>
              {parseInlineMarkdown(quoteText)}
            </Text>
          </Box>
        );
      }
      // Empty lines
      else if (line.trim() === '') {
        elements.push(
          <Box key={`space-${elements.length}`} mb="xs" />
        );
      }
      // Regular text with inline markdown
      else {
        elements.push(
          <Text key={`text-${elements.length}`} size="sm" mb={2} style={{ wordWrap: 'break-word', overflowWrap: 'break-word' }}>
            {parseInlineMarkdown(line)}
          </Text>
        );
      }
      
      i++;
    }
    
    return elements;
  };

  return (
    <Stack h="100vh" gap={0} style={{ overflow: 'hidden' }}>
      {/* Chat Header */}
      <Box p="md" style={{ borderBottom: '1px solid var(--mantine-color-gray-4)', flexShrink: 0 }}>
        <Text size="sm" fw={500}>AI Assistant</Text>
        {repoUrl && (
          <Text size="xs" c="dimmed" truncate>
            {repoUrl}
          </Text>
        )}
      </Box>

      {/* Messages Area */}
      <ScrollArea 
        flex={1} 
        p="sm"
        ref={scrollAreaRef}
        type="hover"
        style={{ minHeight: 0, maxWidth: '100%' }}
      >
        <Stack gap="xs" style={{ maxWidth: '100%' }}>
          {messages.map((message) => (
            message.role === 'user' ? (
              <Paper
                key={message.id}
                p="sm"
                radius="md"
                bg="transparent"
                style={{
                  border: '1px solid var(--mantine-color-blue-6)',
                  maxWidth: '100%',
                  wordWrap: 'break-word',
                  overflowWrap: 'break-word'
                }}
              >
                <Box style={{ maxWidth: '100%', overflow: 'hidden' }}>
                  {formatMessage(message.content)}
                </Box>
              </Paper>
            ) : (
              <Box key={message.id} py="xs" px="sm" style={{ maxWidth: '100%' }}>
                <Box style={{ maxWidth: '100%', overflow: 'hidden' }}>
                  {formatMessage(message.content)}
                </Box>
              </Box>
            )
          ))}

          {isLoading && (
            <Box py="xs" px="sm">
              <Group gap="xs">
                <Loader size="xs" />
                <Text size="sm" c="dimmed">
                  Thinking...
                </Text>
              </Group>
            </Box>
          )}
        </Stack>
      </ScrollArea>

      {/* Input Area */}
      <Box p="md" style={{ borderTop: '1px solid var(--mantine-color-gray-4)', flexShrink: 0 }}>
        <form onSubmit={handleSubmit}>
          <Group gap="xs">
            <TextInput
              flex={1}
              placeholder="Ask me to make changes..."
              value={input}
              onChange={handleInputChange}
              disabled={isLoading}
              radius="xl"
              size="sm"
            />
            {isLoading ? (
              <ActionIcon
                variant="filled"
                color="red"
                radius="xl"
                size="lg"
                onClick={stop}
              >
                <IconPlayerStop size={16} />
              </ActionIcon>
            ) : (
              <ActionIcon
                type="submit"
                variant="filled"
                color="blue"
                radius="xl"
                size="lg"
                disabled={!input.trim()}
              >
                <IconSend size={16} />
              </ActionIcon>
            )}
          </Group>
        </form>
      </Box>
    </Stack>
  );
}