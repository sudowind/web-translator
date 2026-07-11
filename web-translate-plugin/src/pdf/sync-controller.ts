export type PdfPane = 'pdf' | 'translation';

export type PaneNavigator = (
  pane: PdfPane,
  page: number,
  progress: number,
) => void;

export class SyncController {
  private readonly suspended = new Set<PdfPane>();

  constructor(private readonly navigate: PaneNavigator) {}

  onVisible(source: PdfPane, page: number, progress = 0): void {
    if (this.suspended.has(source)) return;
    const target = source === 'pdf' ? 'translation' : 'pdf';
    this.suspended.add(target);
    this.navigate(target, page, clamp(progress));
  }

  suspend(pane: PdfPane): void {
    this.suspended.add(pane);
  }

  release(pane: PdfPane): void {
    this.suspended.delete(pane);
  }

  userScroll(pane: PdfPane): void {
    this.release(pane);
  }

  resync(): void {
    this.suspended.clear();
  }

  navigateToPage(page: number): void {
    this.suspended.add('pdf');
    this.suspended.add('translation');
    this.navigate('pdf', page, 0);
    this.navigate('translation', page, 0);
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
