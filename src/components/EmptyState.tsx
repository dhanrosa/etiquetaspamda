import React from 'react';
import { Sparkles, Printer, FileDown, Layers, HelpCircle } from 'lucide-react';

interface EmptyStateProps {
  onLoadSample: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ onLoadSample }) => {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 bg-emerald-50/10 rounded-2xl border-2 border-dashed border-emerald-200/60 text-center max-w-lg mx-auto" id="preview-empty-state">
      <div className="flex items-center justify-center w-14 h-14 rounded-full bg-emerald-100/70 text-emerald-700 mb-5 shadow-2xs">
        <Printer className="w-7 h-7" />
      </div>

      <h3 className="text-lg font-semibold text-slate-800 mb-1.5">
        Seu Preview de Etiquetas
      </h3>
      <p className="text-sm text-slate-500 max-w-xs mb-6">
        Cole o código de etiquetas ZPL gerado pelo seu marketplace à esquerda para ver o preview interativo vertical de 10x15cm.
      </p>

      {/* Highlight features */}
      <div className="w-full text-left bg-white border border-emerald-100 rounded-xl p-4 gap-3.5 flex flex-col mb-6 shadow-3xs">
        <div className="flex gap-2.5">
          <Layers className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <span className="text-xs font-semibold text-slate-800 block">Separador Automático</span>
            <span className="text-[11px] text-slate-500">
              Identifica múltiplos blocos de etiquetas (<code className="font-mono bg-slate-100 px-1 text-slate-600 rounded">^XA</code> ... <code className="font-mono bg-slate-100 px-1 text-slate-600 rounded">^XZ</code>) e monta folhas separadas.
            </span>
          </div>
        </div>

        <div className="flex gap-2.5">
          <FileDown className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <span className="text-xs font-semibold text-slate-800 block">PDF Compatível Prontinho</span>
            <span className="text-[11px] text-slate-500">
              Gera arquivos vetorizados configurados exatamente para páginas de 100mm x 150mm.
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2.5 w-full justify-center">
        <button
          onClick={onLoadSample}
          className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition duration-200 shadow-sm hover:shadow-md cursor-pointer"
          id="empty-state-btn-load"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Ver com Exemplo Prontinho</span>
        </button>

        <a
          href="https://labelary.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-slate-600 hover:text-slate-800 border border-slate-200 hover:border-slate-300 text-xs font-semibold px-4 py-2.5 rounded-xl bg-white transition cursor-pointer"
          id="empty-state-btn-help"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          <span>Documentação ZPL</span>
        </a>
      </div>
    </div>
  );
};
