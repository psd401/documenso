import { getEnvelopeDownloadAllUrl } from '../utils/envelope-download';
import { downloadFile } from './download-file';

type DownloadEnvelopeZipProps = {
  envelopeId: string;
  token: string | undefined;

  /**
   * Specifies which version of each document to include in the archive.
   * 'signed': The signed version (default).
   * 'original': The original (unsigned) version.
   */
  version?: 'original' | 'signed';

  /** The base name to use for the downloaded archive (the envelope title). */
  fileName?: string;
};

/**
 * Downloads every document in an envelope as a single ZIP archive.
 */
export const downloadEnvelopeZip = async ({
  envelopeId,
  token,
  version = 'signed',
  fileName,
}: DownloadEnvelopeZipProps) => {
  const downloadUrl = getEnvelopeDownloadAllUrl({
    envelopeId,
    token,
    version,
  });

  const response = await fetch(downloadUrl);

  if (!response.ok) {
    throw new Error(`Failed to download archive (${response.status})`);
  }

  const blob = await response.blob();

  const baseTitle = (fileName ?? 'documents').replace(/\.zip$/, '');

  downloadFile({
    filename: `${baseTitle}.zip`,
    data: blob,
  });
};
