export type PdfPane = 'pdf' | 'translation';

export type PaneNavigator = (
  pane: PdfPane,
  page: number,
  progress: number,
) => void;

export class SyncController {
  private driver: PdfPane | null = null;

  constructor(private readonly navigate: PaneNavigator) {}

  onVisible(source: PdfPane, page: number, progress = 0): void {
    if (this.driver !== source) return;
    const target = source === 'pdf' ? 'translation' : 'pdf';
    this.navigate(target, page, clamp(progress));
  }

  beginUserScroll(pane: PdfPane): void {
    this.driver = pane;
  }

  endUserScroll(pane: PdfPane): void {
    if (this.driver === pane) this.driver = null;
  }

  navigateToPage(page: number): void {
    this.driver = null;
    this.navigate('pdf', page, 0);
    this.navigate('translation', page, 0);
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
