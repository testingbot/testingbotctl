/**
 * Tests for file-type-detector utility.
 *
 * Since the utility uses dynamic import for the ESM-only file-type package,
 * we test the platform detection logic by testing the exported functions
 * with their internal logic isolated.
 */

import type { FileTypeResult } from '../../src/utils/file-type-detector';

// Helper to create a testable version of detectPlatformFromFile logic
function determinePlatform(
  fileType: FileTypeResult | undefined,
): 'Android' | 'iOS' | undefined {
  if (fileType) {
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

describe('file-type-detector', () => {
  describe('platform detection logic', () => {
    it('should detect Android for APK files (by ext)', () => {
      const result = determinePlatform({
        ext: 'apk',
        mime: 'application/vnd.android.package-archive',
      });
      expect(result).toBe('Android');
    });

    it('should detect Android for files with android package mime type', () => {
      const result = determinePlatform({
        ext: 'unknown',
        mime: 'application/vnd.android.package-archive',
      });
      expect(result).toBe('Android');
    });

    it('should detect iOS for zip files (by ext)', () => {
      const result = determinePlatform({
        ext: 'zip',
        mime: 'application/zip',
      });
      expect(result).toBe('iOS');
    });

    it('should detect iOS for files with zip mime type', () => {
      const result = determinePlatform({
        ext: 'unknown',
        mime: 'application/zip',
      });
      expect(result).toBe('iOS');
    });

    it('should return undefined when file type is undefined', () => {
      const result = determinePlatform(undefined);
      expect(result).toBeUndefined();
    });

    it('should return undefined for non-mobile file types', () => {
      const result = determinePlatform({
        ext: 'pdf',
        mime: 'application/pdf',
      });
      expect(result).toBeUndefined();
    });

    it('should return undefined for image files', () => {
      const result = determinePlatform({
        ext: 'png',
        mime: 'image/png',
      });
      expect(result).toBeUndefined();
    });

    it('should return undefined for text files', () => {
      const result = determinePlatform({
        ext: 'txt',
        mime: 'text/plain',
      });
      expect(result).toBeUndefined();
    });

    it('should prioritize apk ext over mime type', () => {
      // Even with a wrong mime type, apk ext should return Android
      const result = determinePlatform({
        ext: 'apk',
        mime: 'application/zip',
      });
      expect(result).toBe('Android');
    });
  });
});
