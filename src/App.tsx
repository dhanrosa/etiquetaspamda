import { useState, useEffect, useRef } from 'react';
import { 
  Printer, 
  FileDown, 
  RefreshCw, 
  HelpCircle, 
  Layers, 
  Settings2, 
  AlertCircle, 
  CheckCircle2, 
  ChevronRight, 
  Info,
  ExternalLink,
  BookOpen,
  ArrowRight
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { LabelData, RenderConfig } from './types';
import { ZplEditor } from './components/ZplEditor';
import { LabelPreview } from './components/LabelPreview';
import { EmptyState } from './components/EmptyState';
import { SAMPLE_ZPL } from './utils/sample';

const LABELARY_FREE_MAX_LABELS_PER_REQUEST = 50;
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export default function App() {
  const [zplCode, setZplCode] = useState<string>('');
  const [labels, setLabels] = useState<LabelData[]>([]);
  const objectUrlsRef = useRef<string[]>([]);
  const [config, setConfig] = useState<RenderConfig>({
    dpmm: 8, // Standard 203 DPI for thermal printers
    width: 4,  // 4 inches (~10cm)
    height: 6, // 6 inches (~15cm)
  });
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [renderProgress, setRenderProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [showConfig, setShowConfig] = useState<boolean>(false);
  const [showHelp, setShowHelp] = useState<boolean>(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'err'; text: string } | null>(null);

  // Clean up object URLs only when the app unmounts. During processing the labels
  // list is updated many times; revoking URLs on each update can invalidate images
  // that are still visible in the preview.
  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      objectUrlsRef.current = [];
    };
  }, []);

  // Helper to check if a block contains any printing command (not just administrative ones like deleting memory ^IDR)
  const isPrintableBlock = (block: string): boolean => {
    const upper = block.toUpperCase();
    return (
      upper.includes('^FD') || 
      upper.includes('^FT') || 
      upper.includes('^XG') || 
      upper.includes('^GF') || 
      upper.includes('^GB') ||
      upper.includes('^GD') ||
      upper.includes('^GE') ||
      upper.includes('^BC') ||
      upper.includes('^BY') ||
      upper.includes('^BQ') ||
      upper.includes('^B') || // matches general barcode tags too
      upper.includes('^A')    // matches general Alphanumeric text tags too
    );
  };

  // Split ZPL text block into separate items
  const splitZpl = (rawZpl: string): string[] => {
    const cleanZpl = rawZpl.trim();
    if (!cleanZpl) return [];

    // Segmenta preservando o trecho imediatamente anterior a cada ^XA.
    // Em etiquetas da Shopee, imagens/recursos embutidos podem vir antes do ^XA
    // de cada etiqueta; tratar o primeiro trecho como "global" replica a primeira
    // imagem em todas as etiquetas.
    const blockRegex = /\^XA[\s\S]*?\^XZ/gi;
    const matches = Array.from(cleanZpl.matchAll(blockRegex));
    
    if (matches && matches.length > 0) {
      let previousEnd = 0;
      const segmentedBlocks = matches.map(match => {
        const matchIndex = match.index ?? 0;
        const matchText = match[0];
        const segment = cleanZpl.slice(previousEnd, matchIndex + matchText.length).trim();
        previousEnd = matchIndex + matchText.length;
        return segment;
      });
      return segmentedBlocks.filter(isPrintableBlock);
    }

    // Fallback split if formatting is slightly loose but tags exist
    if (cleanZpl.toUpperCase().includes('^XA') || cleanZpl.toUpperCase().includes('^XZ')) {
      const rawBlocks = cleanZpl
        .split(/\^XZ/i)
        .map(p => p.trim())
        .filter(p => p.length > 0)
        .map(p => {
          let block = p;
          if (!block.toUpperCase().startsWith('^XA')) {
            block = '^XA\n' + block;
          }
          if (!block.toUpperCase().endsWith('^XZ')) {
            block = block + '\n^XZ';
          }
          return block;
        });

      return rawBlocks.filter(isPrintableBlock);
    }

    // fallback when they just paste raw data containing no wrappers
    const fallbackBlock = `^XA\n${cleanZpl}\n^XZ`;
    return isPrintableBlock(fallbackBlock) ? [fallbackBlock] : [];
  };

  const detectedCount = splitZpl(zplCode).length;

  // Triggers rendering calls to the Labelary API
  const updatePreview = async () => {
    const ZplBlocks = splitZpl(zplCode);
    if (ZplBlocks.length === 0) {
      setFeedbackMsg({ type: 'err', text: 'Por favor, insira ou cole seu código ZPL primeiro.' });
      return;
    }

    if (ZplBlocks.length > LABELARY_FREE_MAX_LABELS_PER_REQUEST) {
      setFeedbackMsg({
        type: 'err',
        text: `O plano livre da Labelary permite ate ${LABELARY_FREE_MAX_LABELS_PER_REQUEST} etiquetas por envio. Divida o ZPL em lotes menores.`
      });
      return;
    }

    setIsUpdating(true);
    setRenderProgress({ done: 0, total: ZplBlocks.length });
    setFeedbackMsg({ type: 'success', text: 'Processando etiquetas...' });
    objectUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];

    // Initialize temporary list to show loading placeholders
    const renderRunId = Date.now();
    const initialLabelsList: LabelData[] = ZplBlocks.map((codeText, idx) => ({
      id: `label-${idx}-${renderRunId}`,
      // Cada bloco e enviado separadamente para respeitar os limites do plano livre
      // da Labelary para recursos embutidos. Como cada payload tem uma etiqueta,
      // a URL da Labelary sempre renderiza o indice /0/ desse bloco.
      zpl: codeText,
      index: idx,
      status: 'loading'
    }));
    setLabels(initialLabelsList);

    const updatedLabels: LabelData[] = [];
    let rateLimitWasDetected = false;

    // Fire rendering calls
    for (const item of initialLabelsList) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/render?label=${item.index}&run=${renderRunId}`, {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
          },
          body: JSON.stringify({
            dpmm: config.dpmm,
            width: config.width,
            height: config.height,
            zpl: item.zpl,
            labelIndex: item.index,
            labelaryIndex: 0,
          }),
        });

        if (response.headers.get('X-Labelary-Rate-Limited') === 'true') {
          rateLimitWasDetected = true;
          setFeedbackMsg({
            type: 'success',
            text: 'Muitas etiquetas enviadas simultaneamente. Processando em fila para evitar bloqueio do Labelary.'
          });
        }

        if (response.ok) {
          const blob = await response.blob();
          const imageUrl = URL.createObjectURL(blob);
          objectUrlsRef.current.push(imageUrl);
          
          updatedLabels.push({
            ...item,
            status: 'success',
            imageUrl
          });
        } else {
          // If our server returned an error response JSON, parse it
          let errMsg = 'Erro na resposta do servidor.';
          try {
            const errJson = await response.json();
            errMsg = errJson.error || errMsg;
            if (errJson.rateLimited) {
              rateLimitWasDetected = true;
              setFeedbackMsg({
                type: 'success',
                text: 'Muitas etiquetas enviadas simultaneamente. Processando em fila para evitar bloqueio do Labelary.'
              });
            }
          } catch {
            errMsg = await response.text() || errMsg;
          }

          updatedLabels.push({
            ...item,
            status: 'error',
            errorMessage: errMsg
          });
        }
      } catch (error: any) {
        console.error('Falha de rede ao contatar o Labelary:', error);
        const errMsg = API_BASE_URL
          ? `Nao foi possivel acessar a API em ${API_BASE_URL}. Verifique se o servidor Node esta online e liberado para este dominio.`
          : 'Nao foi possivel acessar /api/render. Se o site foi publicado em hospedagem estatica, suba tambem o servidor Node ou configure VITE_API_BASE_URL.';
        updatedLabels.push({
          ...item,
          status: 'error',
          errorMessage: errMsg
        });
      }

      // Update intermediate state incrementally to look extremely snappy!
      setRenderProgress({ done: updatedLabels.length, total: ZplBlocks.length });
      setLabels([...updatedLabels, ...initialLabelsList.slice(updatedLabels.length)]);
    }

    setIsUpdating(false);
    const successfullyRendered = updatedLabels.filter(l => l.status === 'success').length;
    setFeedbackMsg({
      type: rateLimitWasDetected ? 'success' : 'success',
      text: rateLimitWasDetected
        ? 'Muitas etiquetas enviadas simultaneamente. Processando em fila para evitar bloqueio do Labelary.'
        : `${successfullyRendered} de ${ZplBlocks.length} etiqueta(s) renderizada(s) com sucesso!`
    });
  };

  // Direct trigger to load the test simulation sample
  const handleLoadSample = () => {
    setZplCode(SAMPLE_ZPL);
    // Let's delay update momentarily to let state bind
    setTimeout(() => {
      const btn = document.getElementById('action-btn-update');
      if (btn) btn.click();
    }, 100);
  };

  // Convert rendered blob image URL into base64 for PDF generation
  const getBase64FromBlobUrl = async (url: string): Promise<string> => {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // Generate a multi-page high-quality vector-aligned 10x15cm (100mmx150mm) PDF
  const downloadAllAsPDF = async () => {
    const successfulLabels = labels.filter(l => l.status === 'success' && l.imageUrl);
    if (successfulLabels.length === 0) {
      setFeedbackMsg({ 
        type: 'err', 
        text: 'Nenhuma etiqueta carregada com sucesso para exportação. Clique em ATUALIZAR primeiro.' 
      });
      return;
    }

    setFeedbackMsg({ type: 'success', text: 'Gerando arquivo PDF de alta definição (10x15cm)...' });

    try {
      // 100x150 mm layout configuration
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [100, 150]
      });

      for (let i = 0; i < successfulLabels.length; i++) {
        const label = successfulLabels[i];
        if (i > 0) {
          doc.addPage([100, 150], 'portrait');
        }

        const base64Data = await getBase64FromBlobUrl(label.imageUrl!);
        // Draw image on full boundary (0,0) with size (100mm x 150mm)
        // Compression 'FAST' or 'NONE' to maintain barcode clarity
        doc.addImage(base64Data, 'PNG', 0, 0, 100, 150, undefined, 'FAST');
      }

      doc.save(`etiquetas_venda_${Date.now()}.pdf`);
      setFeedbackMsg({ type: 'success', text: 'PDF de etiquetas baixado com sucesso!' });
    } catch (err: any) {
      console.error('Erro na exportação para PDF:', err);
      setFeedbackMsg({ type: 'err', text: 'Operação cancelada: Falha ao desenhar imagem no PDF.' });
    }
  };

  // Helper downloader for keying in high-res individual PDF sheets
  const downloadSingleAsPDF = async (label: LabelData) => {
    if (!label.imageUrl) return;
    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [100, 150]
      });
      const base64Data = await getBase64FromBlobUrl(label.imageUrl);
      doc.addImage(base64Data, 'PNG', 0, 0, 100, 150, undefined, 'FAST');
      doc.save(`etiqueta_venda_${label.index + 1}.pdf`);
    } catch (err) {
      console.error(err);
      setFeedbackMsg({ type: 'err', text: 'Não foi possível baixar esta etiqueta individual.' });
    }
  };

  // Triggers browser standard print operations
  const triggerPrint = () => {
    const successfulLabels = labels.filter(l => l.status === 'success' && l.imageUrl);
    if (successfulLabels.length === 0) {
      setFeedbackMsg({ 
        type: 'err', 
        text: 'Nenhuma etiqueta carregada com sucesso para impressão. Clique em ATUALIZAR primeiro.' 
      });
      return;
    }
    
    // Simple native browser printing
    window.print();
  };

  const progressPercent = renderProgress.total > 0
    ? Math.round((renderProgress.done / renderProgress.total) * 100)
    : 0;
  const generatedPreviewLabels = labels.filter(label => label.status === 'success' && label.imageUrl);

  return (
    <div className="min-h-screen bg-[#F0F7F4] text-slate-800 flex flex-col font-sans antialiased" id="app-root-container">
      
      {/* Dynamic Feedback Toast notification */}
      {feedbackMsg && (
        <div 
          className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg border text-sm max-w-md transition-all duration-300 animate-slide-in no-print"
          style={{
            backgroundColor: feedbackMsg.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            borderColor: feedbackMsg.type === 'success' ? '#A7F3D0' : '#FCA5A5',
            color: feedbackMsg.type === 'success' ? '#065F46' : '#991B1B'
          }}
          id="toast-notification"
        >
          {feedbackMsg.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
          )}
          <span className="font-medium">{feedbackMsg.text}</span>
          <button 
            type="button"
            className="ml-3 hover:opacity-80 font-bold"
            onClick={() => setFeedbackMsg(null)}
          >
            ×
          </button>
        </div>
      )}

      {/* Main Top Header and Marketplace Integration Bar */}
      <header className="bg-white border-b border-emerald-100 py-4 px-6 sticky top-0 z-40 shadow-2xs no-print">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          
          {/* Logo / Title pairing */}
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="flex items-center justify-center w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-100 text-emerald-700 shadow-3xs cursor-default">
              <Printer className="w-5 h-5 stroke-[2]" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-emerald-900 tracking-tight flex items-center gap-2">
                ETIQUETAS PAMDA CASES
                <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full uppercase tracking-wider">
                  site de impressão de etiquetas zpl para pdf
                </span>
              </h1>
              <p className="text-xs text-slate-500 font-medium">
                Formatador e Conversores de Etiqueta Térmica 100 x 150 mm (10x15cm, Vertical)
              </p>
            </div>
          </div>

          {/* Configuration & Quick Assistance Controls */}
          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            
            {/* FAQ Helper Drawer Toggle */}
            <button
              onClick={() => setShowHelp(!showHelp)}
              className={`flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-xl transition cursor-pointer ${
                showHelp 
                  ? 'bg-emerald-600 text-white' 
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300'
              }`}
              id="header-btn-help"
            >
              <HelpCircle className="w-4 h-4" />
              <span>Onde achar o código?</span>
            </button>

            {/* Config modal button */}
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="flex items-center justify-center p-2 rounded-xl bg-white text-slate-600 border border-slate-200 hover:border-slate-300 hover:text-emerald-700 transition"
              title="Configurações de Impressão"
              id="header-btn-config"
            >
              <Settings2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Dashboard Sub-Container / Layout Configurator Grid */}
      <main className="w-full mx-auto px-4 md:px-6 xl:px-8 py-4 md:py-5 flex-1 flex flex-col gap-4 no-print">
        
        {/* Marketplace Helper Guide Section (Toggled in Toolbar) */}
        {showHelp && (
          <div className="bg-white border border-emerald-100 rounded-2xl p-5 shadow-2xs animate-slide-in relative" id="marketplace-guide-panel">
            <button 
              onClick={() => setShowHelp(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1.5 rounded-lg text-sm"
              id="guide-btn-close"
            >
              Fecchar ×
            </button>
            <h2 className="text-sm font-bold text-emerald-900 mb-3 flex items-center gap-2 uppercase tracking-wide">
              <BookOpen className="w-4 h-4 text-emerald-600" /> Como extrair ZPL nos principais canais de venda
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-3.5 bg-emerald-50/20 border border-emerald-100/40 rounded-xl">
                <span className="font-semibold text-xs text-emerald-800 block mb-1">Mercado Livre (Mercado Envios)</span>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Acesse suas <strong>Vendas</strong>, clique em <span className="italic">Imprimir Etiquetas</span> e mude o formato de destino para impressora térmica ou ZPL nas opções.
                </p>
              </div>

              <div className="p-3.5 bg-emerald-50/20 border border-emerald-100/40 rounded-xl">
                <span className="font-semibold text-xs text-emerald-800 block mb-1">Shopee</span>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  No <strong>Central do Vendedor</strong> &gt; Configurações de Envio, mude o tipo de impressão de etiqueta padrão para <span className="italic">Impressão Térmica (Zebra)</span>.
                </p>
              </div>

              <div className="p-3.5 bg-emerald-50/20 border border-emerald-100/40 rounded-xl">
                <span className="font-semibold text-xs text-emerald-800 block mb-1">Amazon (Easy Ship)</span>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Ao agendar o envio, selecione a opção de formato de documento <strong>"Térmica - ZPL / 4x6""</strong> para obter o código bruto diretamente.
                </p>
              </div>

              <div className="p-3.5 bg-emerald-50/20 border border-emerald-100/40 rounded-xl">
                <span className="font-semibold text-xs text-emerald-800 block mb-1">Melhor Envio / Bling</span>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Nas preferências de impressão de etiquetas, selecione o formato <strong>Zebra ZPL II (Térmico)</strong> do arquivo gerado para copiar o texto.
                </p>
              </div>
            </div>
            
            <div className="mt-4 pt-3.5 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2 text-[11px]">
              <span className="text-slate-500 flex items-center gap-1">
                <Info className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> O código ZPL sempre começa com <code className="bg-slate-100 px-1 rounded font-semibold text-slate-700">^XA</code> e encerra com <code className="bg-slate-100 px-1 rounded font-semibold text-slate-700">^XZ</code>.
              </span>
              <a 
                href="https://api.labelary.com/" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-emerald-700 font-semibold hover:underline flex items-center gap-1 cursor-pointer"
                id="guide-btn-api"
              >
                <span>Documentos Oficial Labelary</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        )}

        {/* Print Configuration Drawer (Toggled in header) */}
        {showConfig && (
          <div className="bg-white border border-emerald-100 rounded-2xl p-5 shadow-2xs animate-slide-in relative flex flex-col gap-4" id="print-config-panel">
            <button 
              onClick={() => setShowConfig(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1.5 rounded-lg text-sm"
              id="config-btn-close"
            >
              Fechar ×
            </button>
            
            <div>
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                Configurações da Folha de Impressão Térmica
              </h3>
              <p className="text-xs text-slate-500">
                Ajuste os parâmetros recomendados de renderização da API para o modelo da sua impressora.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-700">Densidade de Pontos (DPI):</label>
                <select
                  value={config.dpmm}
                  onChange={(e) => setConfig({ ...config, dpmm: Number(e.target.value) })}
                  className="rounded-lg border border-slate-200 bg-white p-2 text-xs focus:outline-hidden focus:border-emerald-500 text-slate-700 font-medium cursor-pointer"
                  id="dpmm-select-input"
                >
                  <option value={6}>152 DPI (6 dpmm)</option>
                  <option value={8}>203 DPI (8 dpmm) - Recomendado / Comum</option>
                  <option value={12}>300 DPI (12 dpmm) - Alta Resolução</option>
                  <option value={24}>600 DPI (24 dpmm) - Máxima Resolução</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-700">Largura (Polegadas):</label>
                <input
                  type="number"
                  step="0.5"
                  value={config.width}
                  onChange={(e) => setConfig({ ...config, width: Math.max(0.5, Number(e.target.value)) })}
                  className="rounded-lg border border-slate-200 bg-white p-2 text-xs focus:outline-hidden focus:border-emerald-500 text-slate-700 font-medium"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-700">Altura (Polegadas):</label>
                <input
                  type="number"
                  step="0.5"
                  value={config.height}
                  onChange={(e) => setConfig({ ...config, height: Math.max(0.5, Number(e.target.value)) })}
                  className="rounded-lg border border-slate-200 bg-white p-2 text-xs focus:outline-hidden focus:border-emerald-500 text-slate-700 font-medium"
                />
              </div>
            </div>

            <div className="bg-[#FFFDF5] p-3 rounded-lg border border-[#F5E6BD] text-[11px] text-[#785E12]">
              💡 <strong>Dica de Vendedor:</strong> A grande maioria das impressoras térmicas nacionais (como Elgin L42 Pro, Zebra ZD220, e Argox OS214 Plus) trabalham perfeitamente em <strong>8 dpmm (203 DPI)</strong> com etiqueta padrão de 10x15cm (formato 4x6 polegadas).
            </div>
          </div>
        )}

        {/* Master Content Layout Splitting */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(460px,0.9fr)_minmax(560px,1.1fr)] gap-5 items-start w-full">
          
          {/* LADO ESQUERDO: ZPL Editor Input Space & Buttons (5 Columns) */}
          <div className="flex flex-col gap-3 min-w-0">
            
            {/* Input Wrapper component */}
            <ZplEditor 
              value={zplCode} 
              onChange={setZplCode}
              onUpdate={updatePreview}
              labelCount={detectedCount}
            />

            {/* Action panel underneath - print, update, download */}
            <div className="grid grid-cols-3 gap-3">
              {/* ATUALIZAR Button */}
              <button
                onClick={updatePreview}
                disabled={isUpdating || !zplCode.trim()}
                className="flex flex-col items-center justify-center p-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:hover:bg-emerald-600 font-semibold text-white transition duration-200 cursor-pointer shadow-xs hover:shadow-md select-none group gap-1 [&_svg]:pointer-events-none"
                title="Converter o código ZPL digitado"
                id="action-btn-update"
              >
                <RefreshCw className={`w-5 h-5 ${isUpdating ? 'animate-spin' : 'group-hover:rotate-45'} transition duration-300`} />
                <span className="text-xs tracking-wide font-bold uppercase mt-1">ATUALIZAR</span>
              </button>

              {/* IMPRIMIR Button */}
              <button
                onClick={triggerPrint}
                disabled={labels.length === 0 || isUpdating}
                className="flex flex-col items-center justify-center p-3.5 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:hover:bg-teal-600 font-semibold text-white transition duration-200 cursor-pointer shadow-xs hover:shadow-md select-none gap-1 [&_svg]:pointer-events-none"
                title="Abre diálogo de impressão do navegador"
                id="action-btn-print"
              >
                <Printer className="w-5 h-5 text-teal-100" />
                <span className="text-xs tracking-wide font-bold uppercase mt-1">IMPRIMIR</span>
              </button>

              {/* BAIXAR PDF Button */}
              <button
                onClick={downloadAllAsPDF}
                disabled={labels.length === 0 || isUpdating}
                className="flex flex-col items-center justify-center p-3.5 rounded-xl bg-slate-700 hover:bg-slate-800 disabled:opacity-50 disabled:hover:bg-slate-700 font-semibold text-white transition duration-200 cursor-pointer shadow-xs hover:shadow-md select-none gap-1 [&_svg]:pointer-events-none"
                title="Baixar arquivo contendo todas as etiquetas unificadas"
                id="action-btn-download"
              >
                <FileDown className="w-5 h-5 text-slate-300" />
                <span className="text-xs tracking-wide font-bold uppercase mt-1 text-center truncate w-full">BAIXAR PDF</span>
              </button>
            </div>

            {/* Print Help Banner info for Sellers */}
            <div className="bg-white/80 border border-emerald-100 rounded-xl p-4 text-xs font-medium text-emerald-800 flex items-start gap-2.5 shadow-2xs">
              <span className="p-1 px-2 rounded-md bg-emerald-100 text-emerald-800 font-mono text-xs">
                OK
              </span>
              <p className="leading-relaxed">
                As páginas do PDF baixado são formatadas no tamanho ideal <strong>100x150 mm</strong>. Ao imprimir, lembre de marcar <span className="underline font-semibold">"Ajustar à página"</span> nas opções da impressora para não cortar os códigos de barras.
              </p>
            </div>

          </div>

          {/* LADO DIREITO/CENTRO: Live Multi-Label Preview Grid (7 Columns) */}
          <div className="flex flex-col gap-3 min-w-0">
            
            {/* Display header information of what is rendered */}
            <div className="flex items-center justify-between px-2">
              <div className="flex flex-col">
                <h2 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 uppercase tracking-wide">
                  <Layers className="w-4 h-4 text-emerald-600" /> Painel de Visualização
                </h2>
                <span className="text-[11px] text-slate-400 font-medium">
                  Formatado para rolo térmico padrão 10x15cm na vertical
                </span>
              </div>

              {labels.length > 0 && (
                <span className="text-xs font-semibold px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-full animate-pulse flex items-center gap-1">
                  <span>{labels.filter(l => l.status === 'success').length} carregada(s)</span>
                </span>
              )}
            </div>

            {/* Rendering Panel Container */}
            <div className="bg-[#E2EFEB]/60 border border-emerald-200/50 rounded-2xl p-4 md:p-5 min-h-[420px] h-[calc(100vh-230px)] max-h-[720px] overflow-y-auto" id="labels-scroll-view">
              {labels.length === 0 ? (
                <EmptyState onLoadSample={handleLoadSample} />
              ) : (
                <div className="flex flex-col gap-4 max-w-md mx-auto w-full">
                  {isUpdating && (
                    <div className="w-full bg-white border border-emerald-100 rounded-xl p-4 shadow-xs sticky top-0 z-10">
                      <div className="flex items-center justify-between text-xs font-semibold text-emerald-900 mb-2">
                        <span>Processando etiquetas...</span>
                        <span>{renderProgress.done}/{renderProgress.total}</span>
                      </div>
                      <div className="h-2.5 w-full bg-emerald-50 rounded-full overflow-hidden border border-emerald-100">
                        <div
                          className="h-full bg-emerald-600 transition-all duration-300"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
                        A proxima etiqueta pode aguardar alguns segundos quando a Labelary limita requisicoes.
                      </p>
                    </div>
                  )}

                  {isUpdating && generatedPreviewLabels.length === 0 ? (
                    <div className="min-h-[300px] flex items-center justify-center text-xs font-semibold text-emerald-800">
                      Aguardando a primeira etiqueta gerada...
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 w-full">
                      {(isUpdating ? generatedPreviewLabels : labels).map((item) => (
                        <LabelPreview 
                          key={item.id} 
                          label={item} 
                          config={config}
                          onDownloadSingle={downloadSingleAsPDF}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            
          </div>

        </div>

        {/* Informative Help Guide cards for e-commerce marketplaces */}
        <div className="hidden" id="quick-ecommerce-faq">
          <h3 className="text-sm font-bold text-emerald-900 mb-4 uppercase tracking-wider">
            Recomendações de Impressão de Etiquetas por Marketplace
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-4 bg-white rounded-xl border border-emerald-50 shadow-3xs">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                <span className="font-semibold text-xs text-slate-700">Mercado Livre (Full / Envios)</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Se você envia com Mercado Envios Coleta ou Flex, o formato <strong>10x15cm vertical</strong> gerado neste site permite a colagem de códigos de rastreio e notas fiscais de forma limpa.
              </p>
            </div>

            <div className="p-4 bg-white rounded-xl border border-emerald-50 shadow-3xs">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                <span className="font-semibold text-xs text-slate-700">Shopee Envios</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                O arquivo é perfeitamente adequado para impressão em papéis térmicos adesivos. Ao imprimir pelo celular ou tablet, configure a impressora para usar papel com largura de 100 mm.
              </p>
            </div>

            <div className="p-4 bg-white rounded-xl border border-emerald-50 shadow-3xs">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                <span className="font-semibold text-xs text-slate-700">Amazon Fácil</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                As informações como destinatário de carga e código de barras postal não sofrem perda de distorção ou embaçamento na conversão do PDF gerado pelo ZPL Impressão Rápida.
              </p>
            </div>
          </div>
        </div>

      </main>

      {/* Footer Branding */}
      <footer className="mt-auto bg-emerald-950 text-emerald-200/60 py-4 px-6 text-center text-xs border-t border-emerald-900 no-print">
        <p>© {new Date().getFullYear()} ZPL Impressão Rápida · Otimizada para impressoras térmicas e etiquetas adesivas de 10x15cm.</p>
      </footer>

      {/* PRINT-ONLY AREA: Hidden from screen, strictly utilized by @media print */}
      <div className="hidden print:block bg-white text-black min-h-screen p-0 m-0" id="print-media-section">
        {labels
          .filter(label => label.status === 'success' && label.imageUrl)
          .map((label, idx) => (
            <div 
              key={label.id} 
              className="flex items-center justify-center p-0 m-0 print-page"
              style={{ 
                pageBreakAfter: 'always', 
                pageBreakInside: 'avoid',
                height: '150mm',
                width: '100mm',
                overflow: 'hidden'
              }}
            >
              <img 
                src={label.imageUrl} 
                alt={`Impression page index ${idx}`}
                className="w-full h-full object-contain print-image"
                referrerPolicy="no-referrer"
              />
            </div>
          ))}
      </div>

    </div>
  );
}
