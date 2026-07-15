import type {
  SymbolQueryCompleteness,
  SymbolQueryDiagnostics,
  SymbolQueryFallbackReason,
  SymbolQueryGraphStatus,
  SymbolQuerySourceMode,
} from '../types.js';

export class SymbolQueryDiagnosticsBuilder {
  private sourceMode: SymbolQuerySourceMode = 'direct';
  private graphStatus: SymbolQueryGraphStatus = 'disabled';
  private completeness: SymbolQueryCompleteness = 'fallback';
  private fallbackReason: SymbolQueryFallbackReason | null = 'graph_disabled';
  private scannedFilesCount = 0;
  private skippedFilesCount = 0;
  private unreadableShardsCount = 0;
  private graphGeneration?: number;

  setGraph(status: SymbolQueryGraphStatus, generation?: number) {
    this.graphStatus = status;
    this.graphGeneration = generation;
    return this;
  }

  setSourceMode(mode: SymbolQuerySourceMode) {
    this.sourceMode = mode;
    return this;
  }

  setCompleteness(completeness: SymbolQueryCompleteness, reason: SymbolQueryFallbackReason | null = null) {
    this.completeness = completeness;
    this.fallbackReason = reason;
    return this;
  }

  setScannedFilesCount(count: number) {
    this.scannedFilesCount = count;
    return this;
  }

  incrementSkippedFilesCount(count = 1) {
    this.skippedFilesCount += count;
    return this;
  }

  incrementUnreadableShardsCount(count = 1) {
    this.unreadableShardsCount += count;
    return this;
  }

  build(): SymbolQueryDiagnostics {
    return {
      source_mode: this.sourceMode,
      graph_status: this.graphStatus,
      completeness: this.completeness,
      fallback_reason: this.fallbackReason,
      scanned_files_count: this.scannedFilesCount,
      skipped_files_count: this.skippedFilesCount,
      unreadable_shards_count: this.unreadableShardsCount,
      graph_generation: this.graphGeneration,
    };
  }
}
