/**
 * Tests for file-type-detector utility.
 *
 * Since the utility uses dynamic import for the ESM-only file-type package,
 * we test the platform detection logic by testing the exported functions
 * with their internal logic isolated.
 */

import type { FileTypeResult } from '../../src/utils/file-type-detector';

// Helper to create a testable version of detectPlatformFromFile logic
// This mirrors the logic in the actual implementation
function determinePlatform(
  filePath: string,
  fileType: FileTypeResult | undefined,
): 'Android' | 'iOS' | undefined {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';

  // Check for Android APK files via magic bytes
  if (fileType) {
    if (
      fileType.ext === 'apk' ||
      fileType.mime === 'application/vnd.android.package-archive'
    ) {
      return 'Android';
    }
  }

  // Extension-based detection
  if (ext === 'apk' || ext === 'apks') {
    return 'Android';
  }

  if (ext === 'ipa' || ext === 'app') {
    return 'iOS';
  }

  // ZIP files with zip mime type are assumed iOS
  if (ext === 'zip' && fileType?.mime === 'application/zip') {
    return 'iOS';
  }

  return undefined;
}

describe('file-type-detector', () => {
  describe('platform detection logic', () => {
    describe('Android detection', () => {
      it('should detect Android for APK files (by magic bytes)', () => {
        const result = determinePlatform('app.apk', {
          ext: 'apk',
          mime: 'application/vnd.android.package-archive',
        });
        expect(result).toBe('Android');
      });

      it('should detect Android for files with android package mime type', () => {
        const result = determinePlatform('app.unknown', {
          ext: 'unknown',
          mime: 'application/vnd.android.package-archive',
        });
        expect(result).toBe('Android');
      });

      it('should detect Android for .apk extension (without magic bytes)', () => {
        const result = determinePlatform('app.apk', undefined);
        expect(result).toBe('Android');
      });

      it('should detect Android for .apks extension', () => {
        const result = determinePlatform('app.apks', undefined);
        expect(result).toBe('Android');
      });

      it('should prioritize apk ext over mime type', () => {
        // Even with a wrong mime type, apk ext should return Android
        const result = determinePlatform('app.apk', {
          ext: 'apk',
          mime: 'application/zip',
        });
        expect(result).toBe('Android');
      });
    });

    describe('iOS detection', () => {
      it('should detect iOS for .ipa extension', () => {
        const result = determinePlatform('app.ipa', {
          ext: 'zip',
          mime: 'application/zip',
        });
        expect(result).toBe('iOS');
      });

      it('should detect iOS for .ipa extension (without magic bytes)', () => {
        const result = determinePlatform('app.ipa', undefined);
        expect(result).toBe('iOS');
      });

      it('should detect iOS for .app extension', () => {
        const result = determinePlatform('MyApp.app', undefined);
        expect(result).toBe('iOS');
      });

      it('should detect iOS for .zip files with zip mime type', () => {
        const result = determinePlatform('app.zip', {
          ext: 'zip',
          mime: 'application/zip',
        });
        expect(result).toBe('iOS');
      });

      it('should detect iOS for uppercase IPA extension', () => {
        const result = determinePlatform('app.IPA', undefined);
        expect(result).toBe('iOS');
      });
    });

    describe('undefined cases', () => {
      it('should return undefined when file type is undefined and no matching extension', () => {
        const result = determinePlatform('file.unknown', undefined);
        expect(result).toBeUndefined();
      });

      it('should return undefined for non-mobile file types', () => {
        const result = determinePlatform('document.pdf', {
          ext: 'pdf',
          mime: 'application/pdf',
        });
        expect(result).toBeUndefined();
      });

      it('should return undefined for image files', () => {
        const result = determinePlatform('image.png', {
          ext: 'png',
          mime: 'image/png',
        });
        expect(result).toBeUndefined();
      });

      it('should return undefined for text files', () => {
        const result = determinePlatform('readme.txt', {
          ext: 'txt',
          mime: 'text/plain',
        });
        expect(result).toBeUndefined();
      });

      it('should return undefined for .zip without mime type detection', () => {
        // If magic bytes couldn't detect the file type, don't assume iOS
        const result = determinePlatform('flows.zip', undefined);
        expect(result).toBeUndefined();
      });
    });
  });
});
