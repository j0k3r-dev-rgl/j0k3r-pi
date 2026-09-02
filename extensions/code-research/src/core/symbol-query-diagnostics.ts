import type {
  SymbolQueryCompleteness,
  SymbolQueryDiagnostics,
  SymbolQueryUnavailableReason,
  SymbolQueryGraphStatus,
  SymbolQuerySourceMode,
} from '../types.js';

export class SymbolQueryDiagnosticsBuilder {
  private sourceMode: SymbolQuerySourceMode = 'graph';
  private graphStatus: SymbolQueryGraphStatus = 'disabled';
  private completeness: SymbolQueryCompleteness = 'unavailable';
  private unavailableReason: SymbolQueryUnavailableReason | null = null;
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

  setCompleteness(completeness: SymbolQueryCompleteness, reason: SymbolQueryUnavailableReason | null = null) {
    this.completeness = completeness;
    this.unavailableReason = reason;
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
      graph_unavailable_reason: this.unavailableReason,
      scanned_files_count: this.scannedFilesCount,
      skipped_files_count: this.skippedFilesCount,
      unreadable_shards_count: this.unreadableShardsCount,
      graph_generation: this.graphGeneration,
    };
  }
}
