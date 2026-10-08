// Mock behaviours for files, images, and notes operations

function ensure(state) {
  if (!state.files) {
    state.files = [
      {
        fileId: 'file-1',
        title: 'Main Hall Layout',
        attributes: ['Bosch.Synoptic.Layout'],
        payload: '<?xml version="1.0"?><layout><seats>20</seats></layout>',
      },
      {
        fileId: 'file-2',
        title: 'Secondary Hall Layout',
        attributes: ['Bosch.Synoptic.Layout'],
        payload: '<?xml version="1.0"?><layout><seats>15</seats></layout>',
      },
    ];
  }

  if (!state.images) {
    state.images = [
      {
        name: 'background-1.jpg',
        imageData: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      },
      {
        name: 'background-2.png',
        imageData: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P9/BAADhgEAWjR9awAAAABJRU5ErkJggg==',
      },
    ];
  }

  if (!state.notes) {
    state.notes = [
      {
        fileName: 'meeting-2026-10-01.xml',
        fileType: 'meeting',
        creationDateTime: '2026-10-01T10:30:00Z',
        isTampered: false,
        content: '<?xml version="1.0"?><meeting><title>Board Meeting</title></meeting>',
      },
      {
        fileName: 'voting-2026-10-02.xml',
        fileType: 'voting',
        creationDateTime: '2026-10-02T14:15:00Z',
        isTampered: false,
        content: '<?xml version="1.0"?><voting><title>Resolution Vote</title></voting>',
      },
      {
        fileName: 'meeting-2026-10-03.xml',
        fileType: 'meeting',
        creationDateTime: '2026-10-03T09:00:00Z',
        isTampered: false,
        content: '<?xml version="1.0"?><meeting><title>Strategy Meeting</title></meeting>',
      },
    ];
  }
}

function generateFileId() {
  return `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function dateStringToDateObject(dateStr) {
  // Parse 'yyyy-MM-dd' format to Date
  const parts = dateStr.split('-');
  if (parts.length !== 3) return null;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
  return new Date(year, month - 1, day);
}

function extractDateFromDateTime(dateTimeStr) {
  // Extract date from ISO 8601 format like '2026-10-01T10:30:00Z'
  return dateTimeStr.split('T')[0];
}

function isDateInRange(dateStr, startDate, endDate) {
  const fileDate = dateStringToDateObject(dateStr);
  if (!fileDate) return true;

  let includeStart = true;
  let includeEnd = true;

  if (startDate) {
    const start = dateStringToDateObject(startDate);
    if (start && fileDate < start) includeStart = false;
  }

  if (endDate) {
    const end = dateStringToDateObject(endDate);
    if (end) {
      // Include the entire end date
      end.setHours(23, 59, 59, 999);
      if (fileDate > end) includeEnd = false;
    }
  }

  return includeStart && includeEnd;
}

export default {
  ListFiles: (ctx, params) => {
    ensure(ctx.state);
    const attributes = params?.attributes ?? [];

    const filtered = attributes.length === 0
      ? ctx.state.files
      : ctx.state.files.filter(f =>
          attributes.some(attr => f.attributes?.includes(attr))
        );

    return {
      fileInfoList: filtered.map(f => ({
        fileId: f.fileId,
        title: f.title,
      })),
    };
  },

  CreateFile: (ctx, { attributes, payload, title }) => {
    ensure(ctx.state);

    if (!title || typeof title !== 'string' || title.trim() === '') {
      ctx.fail('Title is required');
    }
    if (!Array.isArray(attributes) || attributes.length === 0) {
      ctx.fail('Attributes are required');
    }
    if (payload === undefined || payload === null) {
      ctx.fail('Payload is required');
    }

    // Check for duplicate title
    if (ctx.state.files.some(f => f.title === title)) {
      ctx.fail(`File with title '${title}' already exists`);
    }

    const fileId = generateFileId();
    ctx.state.files.push({
      fileId,
      title,
      attributes,
      payload,
    });

    ctx.fire('fileChanged');
    return { fileId };
  },

  UpdateFile: (ctx, { fileId, attributes, payload, title }) => {
    ensure(ctx.state);

    const file = ctx.state.files.find(f => f.fileId === fileId);
    if (!file) {
      ctx.fail(`File with id '${fileId}' not found`);
    }

    if (title !== undefined && (typeof title !== 'string' || title.trim() === '')) {
      ctx.fail('Title must be a non-empty string');
    }

    // Check for duplicate title (if changing title)
    if (title && title !== file.title && ctx.state.files.some(f => f.title === title)) {
      ctx.fail(`File with title '${title}' already exists`);
    }

    if (attributes !== undefined && (!Array.isArray(attributes) || attributes.length === 0)) {
      ctx.fail('Attributes must be a non-empty array');
    }

    if (title !== undefined) file.title = title;
    if (attributes !== undefined) file.attributes = attributes;
    if (payload !== undefined) file.payload = payload;

    ctx.fire('fileChanged');
    return {};
  },

  LoadFile: (ctx, { fileId }) => {
    ensure(ctx.state);

    const file = ctx.state.files.find(f => f.fileId === fileId);
    if (!file) {
      ctx.fail(`File with id '${fileId}' not found`);
    }

    return {
      fileInfo: {
        fileId: file.fileId,
        title: file.title,
        attributes: file.attributes,
        payload: file.payload,
      },
    };
  },

  DeleteFile: (ctx, { fileId }) => {
    ensure(ctx.state);

    const idx = ctx.state.files.findIndex(f => f.fileId === fileId);
    if (idx < 0) {
      ctx.fail(`File with id '${fileId}' not found`);
    }

    ctx.state.files.splice(idx, 1);
    ctx.fire('fileChanged');
    return {};
  },

  ListImages: (ctx) => {
    ensure(ctx.state);
    return {
      images: ctx.state.images.map(img => img.name),
    };
  },

  SaveImage: (ctx, { imageData, name }) => {
    ensure(ctx.state);

    if (!name || typeof name !== 'string' || name.trim() === '') {
      ctx.fail('Image name is required');
    }
    if (!imageData || typeof imageData !== 'string') {
      ctx.fail('Image data is required');
    }

    // Check for duplicate name
    const existing = ctx.state.images.find(img => img.name === name);
    if (existing) {
      existing.imageData = imageData;
    } else {
      ctx.state.images.push({ name, imageData });
    }

    // Note: images don't have a 'fileChanged' event per spec, so no ctx.fire here
    return {
      saveImageUri: `/images/${name}`,
    };
  },

  DeleteImage: (ctx, { imageName }) => {
    ensure(ctx.state);

    const idx = ctx.state.images.findIndex(img => img.name === imageName);
    if (idx < 0) {
      ctx.fail(`Image '${imageName}' not found`);
    }

    ctx.state.images.splice(idx, 1);
    return {};
  },

  // 7.0 CHM (WO-044): image check by magic number (PNG, JPEG, GIF, BMP).
  ValidateImageFile: (ctx, { imageData = '', imageExt = '' }) => {
    const b = Buffer.from(String(imageData), 'base64');
    const kind = b.subarray(0, 4).toString('hex').startsWith('89504e47') ? 'png'
      : b.subarray(0, 3).toString('hex') === 'ffd8ff' ? 'jpg'
      : b.subarray(0, 3).toString() === 'GIF' ? 'gif' : b.subarray(0, 2).toString() === 'BM' ? 'bmp' : null;
    const ext = String(imageExt).replace(/^\./, '').toLowerCase().replace('jpeg', 'jpg');
    return { isValidImageFile: Boolean(kind) && (!ext || ext === kind) };
  },

  GetImageServerInfo: (ctx) => {
    return {
      uri: 'http://localhost:8080/images/',
    };
  },

  GetNotesFileList: (ctx, params) => {
    ensure(ctx.state);

    const searchDateRange = params?.searchDateRange ?? {};
    const startDate = searchDateRange.startDate;
    const endDate = searchDateRange.endDate;

    const filtered = ctx.state.notes.filter(note => {
      const fileDate = extractDateFromDateTime(note.creationDateTime);
      return isDateInRange(fileDate, startDate, endDate);
    });

    return {
      fileData: filtered.map(note => ({
        fileName: note.fileName,
        fileType: note.fileType,
        creationDateTime: note.creationDateTime,
        isTampered: note.isTampered,
        fileSize: Buffer.byteLength(note.content), // since 6.7
        needsTransform: false, // since 6.7
      })),
    };
  },

  // DICENTIS 6.7+ (WO-044, 7.0 CHM). FileBytes as base64 (.NET byte[] serialisation), unverified on a real server.
  GetTransformedNotesFilesInfo: (ctx, { fileName }) => {
    ensure(ctx.state);
    const note = ctx.state.notes.find(n => n.fileName === fileName) ?? ctx.fail(`Notes file '${fileName}' not found`);
    const { content, ...info } = note;
    return { notesFileInfo: { ...info, fileSize: Buffer.byteLength(content), needsTransform: false } };
  },
  ReadNotesFile: (ctx, { fileName, offset = 0, length = 0 }) => {
    ensure(ctx.state);
    const note = ctx.state.notes.find(n => n.fileName === fileName) ?? ctx.fail(`Notes file '${fileName}' not found`);
    if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0) ctx.fail('offset and length must be non-negative integers');
    return { FileBytes: Buffer.from(note.content).subarray(offset, offset + length).toString('base64') };
  },

  DeleteNotesFiles: (ctx, { fileNames }) => {
    ensure(ctx.state);

    if (!Array.isArray(fileNames) || fileNames.length === 0) {
      ctx.fail('File names array is required');
    }

    const notFoundNames = fileNames.filter(
      name => !ctx.state.notes.some(n => n.fileName === name)
    );
    if (notFoundNames.length > 0) {
      ctx.fail(`Files not found: ${notFoundNames.join(', ')}`);
    }

    fileNames.forEach(name => {
      const idx = ctx.state.notes.findIndex(n => n.fileName === name);
      if (idx >= 0) ctx.state.notes.splice(idx, 1);
    });

    ctx.fire('notesFileListChanged');
    return { success: true };
  },

  TransformNotesFile: (ctx, { fileName }) => {
    ensure(ctx.state);

    const note = ctx.state.notes.find(n => n.fileName === fileName);
    if (!note) {
      ctx.fail(`Notes file '${fileName}' not found`);
    }

    // Simple HTML transformation of the XML content
    const htmlContent = note.content
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return {
      notesHtml: `<html><body><pre>${htmlContent}</pre></body></html>`,
    };
  },

  CheckNotesFileTampered: (ctx, { fileName }) => {
    ensure(ctx.state);

    const note = ctx.state.notes.find(n => n.fileName === fileName);
    if (!note) {
      ctx.fail(`Notes file '${fileName}' not found`);
    }

    return {
      fileVerificationResponse: {
        isTampered: note.isTampered,
        isDocumentSigned: true,
        isAuthenticatedUsingCertificate: true,
        hasHashTag: true,
      },
    };
  },
};
