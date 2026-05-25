export interface LabelData {
  id: string;
  zpl: string;
  index: number;
  imageUrl?: string;
  status: 'idle' | 'loading' | 'success' | 'error';
  errorMessage?: string;
}

export interface RenderConfig {
  dpmm: number; // dots per mm, e.g., 8 (203 dpi) or 12 (300 dpi)
  width: number; // inches, e.g., 4
  height: number; // inches, e.g., 6 (10x15cm)
}
