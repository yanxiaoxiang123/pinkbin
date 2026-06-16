// Types shared across the CleanupModal split.

export interface DryRunPreview {
  scopeIds: string[];
  totalBytes: number;
  totalFiles: number;
  /** First N paths that would be deleted. Capped to keep the dialog usable. */
  samplePaths: string[];
  /** True when more paths exist than samplePaths shows. */
  truncated: boolean;
}

export const DRY_RUN_SAMPLE_CAP = 80;