import React, { useRef, useEffect, useMemo } from 'react';
import { Sparkles, Trash2, FileText, CheckCircle, AlertTriangle } from 'lucide-react';
import { SAMPLE_ZPL } from '../utils/sample';

interface ZplEditorProps {
  value: string;
  onChange: (value: string) => void;
  onUpdate: () => void;
  labelCount: number;
}

export const ZplEditor: React.FC<ZplEditorProps> = ({
  value,
  onChange,
  onUpdate,
  labelCount,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  const lines = value.split('\n');
  const totalLines = Math.max(lines.length, 1);
  const duplicatedLineIndexes = useMemo(() => {
    const seen = new Set<string>();
    const duplicates = new Set<number>();

    lines.forEach((line, index) => {
      const normalized = line.trim();
      const isWrapperCommand = /^\^(XA|XZ)$/i.test(normalized);
      if (normalized.length <= 20 || isWrapperCommand) return;

      if (seen.has(normalized)) {
        duplicates.add(index);
        return;
      }

      seen.add(normalized);
    });

    return duplicates;
  }, [lines]);

  // Sync scroll positioning of line numbers with text area
  const handleScroll = () => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  // Run initial alignment or updates
  useEffect(() => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, [value]);

  // Analyze content for standard problems
  const hasStart = value.toUpperCase().includes('^XA');
  const hasEnd = value.toUpperCase().includes('^XZ');
  const hasMismatch = (value.match(/\^XA/gi) || []).length !== (value.match(/\^XZ/gi) || []).length;

  const charactersCount = value.length;
  const sizeKb = (charactersCount / 1024).toFixed(2);

  return (
    <div className="flex flex-col h-[calc(100vh-230px)] max-h-[720px] min-h-[420px] bg-white rounded-2xl border border-emerald-100 shadow-sm overflow-hidden" id="zpl-editor-container">
      {/* Editor Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-emerald-50 bg-emerald-50/40">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-emerald-600" />
          <span className="font-semibold text-emerald-900 text-sm md:text-base">
            Código Fonte ZPL
          </span>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Quick Info pills */}
          <span className="text-xs font-mono px-2 py-1 rounded bg-emerald-100/70 text-emerald-800">
            {charactersCount} chars ({sizeKb} KB)
          </span>
          <button
            onClick={() => onChange(SAMPLE_ZPL)}
            className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-900 bg-white border border-emerald-200 hover:border-emerald-300 px-2.5 py-1.5 rounded-lg transition duration-200 shadow-2xs"
            title="Carregar exemplo padrão"
            id="editor-btn-sample"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
            <span>Exemplo</span>
          </button>
          
          <button
            onClick={() => onChange('')}
            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition duration-200"
            title="Limpar editor"
            id="editor-btn-clear"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Synchronized Text Editor */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Line numbers column */}
        <div
          ref={lineNumbersRef}
          className="w-12 bg-emerald-50/30 text-emerald-600/60 font-mono text-xs text-right pr-3 pl-2 py-4 select-none border-r border-emerald-50 overflow-hidden line-clamp-none overflow-y-hidden"
          style={{ lineHeight: '1.5rem' }}
        >
          {Array.from({ length: totalLines }).map((_, i) => (
            <div
              key={i}
              className={`h-[1.5rem] ${duplicatedLineIndexes.has(i) ? 'text-rose-600 font-bold' : ''}`}
            >
              {lines[i]?.trim() ? i + 1 : ''}
            </div>
          ))}
        </div>

        {/* Real Editor Input */}
        <div className="relative flex-1 min-w-0 bg-emerald-50/5">
          <div
            ref={highlightRef}
            aria-hidden="true"
            className="absolute inset-0 p-4 font-mono text-xs md:text-sm leading-[1.5rem] whitespace-pre overflow-hidden pointer-events-none"
          >
            {lines.map((line, index) => (
              <React.Fragment key={index}>
                <span className={duplicatedLineIndexes.has(index) ? 'text-rose-600 bg-rose-50 font-semibold' : 'text-slate-800'}>
                  {line || ' '}
                </span>
                {index < lines.length - 1 ? '\n' : null}
              </React.Fragment>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onScroll={handleScroll}
            wrap="off"
            className={`absolute inset-0 w-full h-full p-4 font-mono text-xs md:text-sm caret-slate-800 focus:outline-hidden resize-none bg-transparent leading-[1.5rem] selection:bg-emerald-200/50 whitespace-pre overflow-auto ${value ? 'text-transparent' : 'text-slate-400'}`}
            placeholder="Cole seu código ZPL aqui (ex: começando com ^XA e terminando com ^XZ)..."
            spellCheck={false}
            id="editor-zpl-textarea"
          />
        </div>
      </div>

      {/* Quick Validation Indicators footer */}
      <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex flex-wrap justify-between items-center gap-3 text-xs">
        <div className="flex items-center gap-4 flex-wrap">
          {value.trim() === '' ? (
            <span className="text-slate-400 flex items-center gap-1">
              Coloque ZPL para analisar
            </span>
          ) : (
            <>
              <span className="flex items-center gap-1">
                {hasStart && hasEnd && !hasMismatch ? (
                  <span className="text-emerald-700 flex items-center gap-1 font-medium">
                    <CheckCircle className="w-4 h-4 text-emerald-600" /> ZPL Válido
                  </span>
                ) : (
                  <span className="text-amber-700 flex items-center gap-1 font-medium">
                    <AlertTriangle className="w-4 h-4 text-amber-500" /> Estrutura Incompleta
                  </span>
                )}
              </span>

              {hasMismatch && (
                <span className="text-rose-600 font-medium">
                  Controle ^XA e ^XZ desalinhado
                </span>
              )}
            </>
          )}
        </div>
        
        <div className="text-slate-500">
          Etiquetas detectadas: <strong className="text-emerald-700 font-mono">{labelCount}</strong>
        </div>
      </div>
    </div>
  );
};
