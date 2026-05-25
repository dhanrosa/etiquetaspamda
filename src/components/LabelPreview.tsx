import React from 'react';
import { Loader2, AlertCircle, Compass, FileDown } from 'lucide-react';
import { LabelData, RenderConfig } from '../types';

interface LabelPreviewProps {
  label: LabelData;
  config: RenderConfig;
  onDownloadSingle: (label: LabelData) => void;
}

export const LabelPreview: React.FC<LabelPreviewProps> = ({
  label,
  config,
  onDownloadSingle,
}) => {
  if (label.status === 'success' && label.imageUrl) {
    return (
      <div
        className="relative bg-white border border-slate-200 shadow-xs aspect-[2/3] overflow-hidden group"
        id={`label-preview-card-${label.id}`}
      >
        <img
          src={label.imageUrl}
          alt={`Etiqueta de venda ${label.index + 1}`}
          className="w-full h-full object-contain pointer-events-none block"
          referrerPolicy="no-referrer"
        />
        <button
          onClick={() => onDownloadSingle(label)}
          className="absolute top-2 right-2 p-1.5 text-emerald-700 bg-white/90 hover:text-emerald-900 hover:bg-emerald-50 rounded-md shadow-xs border border-emerald-100 transition opacity-0 group-hover:opacity-100 no-print"
          title="Baixar esta etiqueta"
          id={`btn-dl-single-${label.id}`}
        >
          <FileDown className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div 
      className="bg-white rounded-2xl border border-emerald-100/80 shadow-xs hover:shadow-md transition duration-300 p-4 flex flex-col gap-3 group relative"
      id={`label-preview-card-${label.id}`}
    >
      {/* Label Info bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-50 text-emerald-800 font-mono text-xs font-semibold">
            {label.index + 1}
          </span>
          <span className="text-xs font-semibold text-slate-700">
            Etiqueta {label.index + 1}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
            {config.width}x{config.height}" ({config.dpmm === 8 ? '203 DPI' : config.dpmm === 12 ? '300 DPI' : 'Personalizado'})
          </span>
          
          {label.status === 'success' && (
            <button
              onClick={() => onDownloadSingle(label)}
              className="p-1 text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 rounded-md transition"
              title="Baixar esta etiqueta"
              id={`btn-dl-single-${label.id}`}
            >
              <FileDown className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Actual Label Rendering Space (10x15 Aspect Ratio) */}
      <div 
        className="w-full relative bg-slate-50 border border-slate-100 rounded-xl overflow-hidden shadow-2xs aspect-[2/3] flex flex-col items-center justify-center"
        style={{ contentVisibility: 'auto' }}
      >
        {/* Physical label backing simulation */}
        <div className="absolute inset-0 bg-slate-100 flex items-center justify-center p-3">
          <div className="w-full h-full bg-white shadow-lg relative flex items-center justify-center transition-all duration-300 group-hover:scale-[1.01] border border-slate-200">
            {label.status === 'loading' && (
              <div className="absolute inset-0 bg-white/95 backdrop-blur-3xs flex flex-col items-center justify-center gap-2 z-10 animate-pulse">
                <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
                <span className="text-xs text-emerald-800 font-medium">Requisitando Labelary...</span>
              </div>
            )}

            {label.status === 'error' && (
              <div className="absolute inset-0 bg-rose-50/90 flex flex-col items-center justify-center p-5 text-center gap-2.5 z-10">
                <AlertCircle className="w-9 h-9 text-rose-500" />
                <span className="text-xs font-semibold text-rose-800">Falha ao Renderizar</span>
                <p className="text-[10px] text-rose-600 max-w-[200px] leading-relaxed">
                  {label.errorMessage || 'Verifique se há comandos incorretos ou limite de tamanho na API.'}
                </p>
              </div>
            )}

            {label.status === 'success' && label.imageUrl ? (
              <img
                src={label.imageUrl}
                alt={`Etiqueta de venda ${label.index + 1}`}
                className="w-full h-full object-contain pointer-events-none"
                referrerPolicy="no-referrer"
              />
            ) : (
              label.status === 'idle' && (
                <div className="text-slate-400 text-xs flex flex-col items-center gap-2">
                  <Compass className="w-7 h-7 stroke-1 text-slate-300 animate-spin" />
                  <span>Pronto para renderizar</span>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* Quick stats footer of the label */}
      <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono pt-1">
        <span>Dimensão: 100 x 150 mm</span>
        <span>{label.zpl.length} bytes</span>
      </div>
    </div>
  );
};
