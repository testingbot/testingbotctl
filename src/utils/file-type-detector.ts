export interface FileTypeResult {
  ext: string;
  mime: string;
}

/**
 * Detect file type from file content using magic bytes.
 * Returns undefined if the file type cannot be determined.
 */
export async function detectFileType(
  filePath: string,
): Promise<FileTypeResult | undefined> {
  try {
    // Dynamic import for ESM-only file-type package
    const { fileTypeFromFile } = await import('file-type');
    const result = await fileTypeFromFile(filePath);
    return result;
  } catch {
    return undefined;
  }
}

/**
 * Detect platform (Android or iOS) from app file.
 * Uses magic bytes for content detection, with extension fallback for zip-based formats.
 */
export async function detectPlatformFromFile(
  filePath: string,
): Promise<'Android' | 'iOS' | undefined> {
  const fileType = await detectFileType(filePath);

  if (fileType) {
    // APK files are detected as 'application/zip' with ext 'apk'
    // or as 'application/vnd.android.package-archive'
    if (
      fileType.ext === 'apk' ||
      fileType.mime === 'application/vnd.android.package-archive'
    ) {
      return 'Android';
    }

    if (fileType.ext === 'zip' || fileType.mime === 'application/zip') {
      return 'iOS';
    }
  }

  return undefined;
}
