// Types shared across the CleanupModal split. Kept in one place so that
// sub-components (ScopeGroup / CondaPicker / etc.) and the main modal
// agree on the shape of scope-size rows and dry-run previews.

export interface ScopeSize {
  scope_id: string;
  /** Bytes that match scope glob AND are older than the requested retention. */
  bytes: number;
  file_count: number;
  /** Bytes inside the scope regardless of retention — UI uses this so users
   *  can see "12 GB total · 0 GB older than 90d will be cleaned" instead of
   *  the misleading "空" that used to render when retention spared everything. */
  total_bytes: number;
  total_files: number;
}

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