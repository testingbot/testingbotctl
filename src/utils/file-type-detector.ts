import path from 'node:path';

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
 * Get file extension in lowercase without the dot
 */
function getExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase().slice(1);
}

/**
 * Detect platform (Android or iOS) from app file.
 * Uses a combination of magic bytes and file extension for reliable detection.
 *
 * Android: .apk, .apks files
 * iOS: .ipa, .app, .zip files (when not APK)
 */
export async function detectPlatformFromFile(
  filePath: string,
): Promise<'Android' | 'iOS' | undefined> {
  const ext = getExtension(filePath);
  const fileType = await detectFileType(filePath);

  // Check for Android APK files
  if (fileType) {
    if (
      fileType.ext === 'apk' ||
      fileType.mime === 'application/vnd.android.package-archive'
    ) {
      return 'Android';
    }
  }

  // Extension-based detection (more reliable for mobile apps)
  // APK and APKS are Android
  if (ext === 'apk' || ext === 'apks') {
    return 'Android';
  }

  // IPA, APP are iOS
  if (ext === 'ipa' || ext === 'app') {
    return 'iOS';
  }

  // ZIP files could be either, but commonly used for iOS simulator builds
  // If magic bytes detected it as zip and extension is .zip, assume iOS
  if (ext === 'zip' && fileType?.mime === 'application/zip') {
    return 'iOS';
  }

  return undefined;
}
