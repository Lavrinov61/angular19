#!/usr/bin/env node

/**
 * Standalone воркер для обработки фотографий.
 * Работает в чистом Node.js, ВНЕ Angular SSR (esbuild).
 * 
 * Принимает JSON через stdin, отдаёт JSON через stdout.
 * Логи идут в stderr (не мешают JSON-парсингу).
 * 
 * Действия:
 *   processPhotosForPrint  — resize + раскладка + ZIP
 *   archiveOriginalPhotos  — ZIP оригиналов без обработки
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';

// ============================================================================
// Константы
// ============================================================================

/** 300 DPI: 1 см ≈ 118.11 пикселей (300 / 2.54) */
const CM_TO_PX = 118.11;

/** Зазор между фото на листе (см) */
const GAP_CM = 0.5;

/** Стандартные листы для печати (отсортированы от маленького к большему) */
const SHEET_SIZES = [
  { w: 10, h: 15, label: '10×15' },
  { w: 15, h: 20, label: '15×20' },
  { w: 20, h: 30, label: '20×30' },
  { w: 30, h: 40, label: '30×40' },
];

/** Стандартные размеры фотопечати */
const STANDARD_SIZES = {
  '10x15': { w: 10, h: 15 },
  '15x20': { w: 15, h: 20 },
  '20x30': { w: 20, h: 30 },
  '30x40': { w: 30, h: 40 },
  '40x50': { w: 40, h: 50 },
};

// ============================================================================
// Утилиты
// ============================================================================

function log(...args) {
  console.error('[PhotoWorker]', ...args);
}

function cmToPx(cm) {
  return Math.round(cm * CM_TO_PX);
}

function parseSize(size) {
  const match = size.match(/(\d+(?:[.,]\d+)?)\s*[xхX×\*]\s*(\d+(?:[.,]\d+)?)/);
  if (!match) {
    throw new Error(`Невозможно распознать размер: "${size}"`);
  }
  const a = parseFloat(match[1].replace(',', '.'));
  const b = parseFloat(match[2].replace(',', '.'));
  return a <= b ? { w: a, h: b } : { w: b, h: a };
}

function isStandardSize(size) {
  const norm = size.replace(/\s/g, '').replace(/[хХ×\*]/g, 'x').toLowerCase();
  return norm in STANDARD_SIZES;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function cleanupDir(dirPath) {
  try {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  } catch (err) {
    log('Не удалось очистить:', dirPath, err.message);
  }
}

// ============================================================================
// Раскладка: сколько фото помещается на листе
// ============================================================================

function calcLayout(photoW, photoH, sheetW, sheetH, gap) {
  const cols1 = Math.floor((sheetW + gap) / (photoW + gap));
  const rows1 = Math.floor((sheetH + gap) / (photoH + gap));
  const total1 = cols1 * rows1;

  const cols2 = Math.floor((sheetW + gap) / (photoH + gap));
  const rows2 = Math.floor((sheetH + gap) / (photoW + gap));
  const total2 = cols2 * rows2;

  if (total1 >= total2) {
    return { cols: cols1, rows: rows1, total: total1, rotated: false };
  }
  return { cols: cols2, rows: rows2, total: total2, rotated: true };
}

/**
 * Находит лучший стандартный лист для раскладки нестандартного фото.
 * Только для нестандартных размеров (7×7, 8×9 и т.д.)
 */
function findBestLayout(photoW, photoH) {
  for (const sheet of SHEET_SIZES) {
    const result = calcLayout(photoW, photoH, sheet.w, sheet.h, GAP_CM);
    if (result.total >= 2) {
      return {
        sheet: { w: sheet.w, h: sheet.h, label: sheet.label },
        cols: result.cols,
        rows: result.rows,
        total: result.total,
        photoRotated: result.rotated,
      };
    }
  }
  return null;
}

// ============================================================================
// Обработка фото (resize)
// ============================================================================

async function resizePhoto(sourcePath, targetW, targetH, fitMode) {
  const metadata = await sharp(sourcePath).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`Не удалось прочитать размеры: ${sourcePath}`);
  }

  // Подбираем ориентацию целевого размера под ориентацию фото
  const isLandscape = metadata.width > metadata.height;
  let w = targetW, h = targetH;
  if (isLandscape && w < h) [w, h] = [h, w];
  else if (!isLandscape && w > h) [w, h] = [h, w];

  return sharp(sourcePath)
    .rotate() // EXIF auto-rotate
    .resize(w, h, {
      fit: fitMode,
      position: 'center',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
      withoutEnlargement: false,
    })
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

// ============================================================================
// Составной лист (несколько фото на одном листе)
// ============================================================================

async function createCompositeSheet(photoBuffers, photoWidthPx, photoHeightPx,
  sheetWidthPx, sheetHeightPx, cols, rows, gapPx, outputPath) {

  const gridW = cols * photoWidthPx + (cols - 1) * gapPx;
  const gridH = rows * photoHeightPx + (rows - 1) * gapPx;
  const offsetX = Math.round((sheetWidthPx - gridW) / 2);
  const offsetY = Math.round((sheetHeightPx - gridH) / 2);

  const compositeInputs = [];
  for (let idx = 0; idx < photoBuffers.length && idx < cols * rows; idx++) {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    compositeInputs.push({
      input: photoBuffers[idx],
      left: offsetX + col * (photoWidthPx + gapPx),
      top: offsetY + row * (photoHeightPx + gapPx),
    });
  }

  await sharp({
    create: {
      width: sheetWidthPx,
      height: sheetHeightPx,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite(compositeInputs)
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toFile(outputPath);
}

// ============================================================================
// ZIP-архив
// ============================================================================

function createZipArchive(files, outputPath, orderInfo) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 1 } });

    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);

    for (const filePath of files) {
      archive.file(filePath, { name: path.basename(filePath) });
    }

    const lines = [
      `Заказ №${orderInfo.orderNumber || '—'} — печать фотографий`,
      `═══════════════════════════`,
      `Размер фото: ${orderInfo.size} см`,
      orderInfo.printType ? `Тип бумаги: ${orderInfo.printType}` : null,
      orderInfo.borders ? `Поля: ${orderInfo.borders}` : null,
      `Фотографий: ${orderInfo.photosCount} шт.`,
      `Копий каждого: ${orderInfo.copies}`,
    ];

    if (orderInfo.layout) {
      const l = orderInfo.layout;
      lines.push(
        ``,
        `Раскладка: ${l.cols}×${l.rows} = ${l.photosPerSheet} фото на листе ${l.sheetCm} см`,
        `Всего листов: ${l.sheetsTotal}`,
      );
    } else {
      lines.push(`Всего файлов: ${files.length}`);
    }

    lines.push(
      ``,
      `Дата: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`,
      ``,
      `Файлы готовы к печати (300 DPI, JPEG 95%).`,
      `Ориентация автоматически подобрана под каждое фото.`,
    );

    archive.append(lines.filter(l => l !== null).join('\n'), { name: 'info.txt' });
    archive.finalize();
  });
}

// ============================================================================
// Действие: processPhotosForPrint
// ============================================================================

async function processPhotosForPrint(input) {
  const { size, copies, sourcePaths, sessionId, printType, borders,
    perPhotoCopies, pathToMessageId, orderNumber } = input;

  if (!sourcePaths || sourcePaths.length === 0) {
    throw new Error('Нет фотографий для обработки');
  }

  const parsedSize = parseSize(size);
  const photoWPx = cmToPx(parsedSize.w);
  const photoHPx = cmToPx(parsedSize.h);
  const isStandard = isStandardSize(size);

  const cwd = input.cwd || process.cwd();
  const outputDir = path.resolve(cwd, 'uploads/processed', sessionId);
  const archiveDir = path.resolve(cwd, 'uploads/archives');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });

  const processedFiles = [];
  let layoutInfo;

  try {
    // Раскладка: только для НЕСТАНДАРТНЫХ размеров
    // Стандартные (10×15, 15×20...) — 1 фото на 1 лист этого размера
    // Нестандартные (7×7, 8×9...) — несколько фото на стандартном листе для экономии
    const layout = isStandard ? null : findBestLayout(parsedSize.w, parsedSize.h);

    if (layout && layout.total >= 2) {
      // ======== РЕЖИМ РАСКЛАДКИ: несколько фото на одном стандартном листе ========
      const { sheet, cols, rows, total: perSheet, photoRotated } = layout;
      const sheetWPx = cmToPx(sheet.w);
      const sheetHPx = cmToPx(sheet.h);
      const gapPx = cmToPx(GAP_CM);

      const cellW = photoRotated ? photoHPx : photoWPx;
      const cellH = photoRotated ? photoWPx : photoHPx;

      // Плоский список всех «отпечатков»: каждое фото × copies
      const allPrints = [];
      for (const src of sourcePaths) {
        if (!fs.existsSync(src)) continue;
        const msgId = pathToMessageId?.[src];
        const photoCopies = (msgId && perPhotoCopies?.[msgId])
          ? perPhotoCopies[msgId]
          : copies;
        for (let c = 0; c < photoCopies; c++) {
          allPrints.push(src);
        }
      }

      if (allPrints.length === 0) {
        throw new Error('Ни одно фото не было найдено');
      }

      // Ресайзим каждое уникальное фото один раз (кэш буферов)
      // Всегда contain — вписываем без обрезки
      const bufferCache = new Map();
      for (const src of allPrints) {
        if (!bufferCache.has(src)) {
          log(`Resize (layout): ${path.basename(src)} → ${cellW}×${cellH} contain`);
          const buf = await resizePhoto(src, cellW, cellH, 'contain');
          bufferCache.set(src, buf);
        }
      }

      const sheetsTotal = Math.ceil(allPrints.length / perSheet);
      log(`Раскладка: ${cols}×${rows} = ${perSheet} фото/лист ${sheet.label}, листов: ${sheetsTotal}`);

      for (let s = 0; s < sheetsTotal; s++) {
        const chunk = allPrints.slice(s * perSheet, (s + 1) * perSheet);
        const buffers = chunk.map(src => bufferCache.get(src));

        const fileName = `лист_${s + 1}_${sheet.label}_${cols}x${rows}.jpg`;
        const outputPath = path.join(outputDir, fileName);

        await createCompositeSheet(buffers, cellW, cellH,
          sheetWPx, sheetHPx, cols, rows, gapPx, outputPath);
        processedFiles.push(outputPath);
      }

      layoutInfo = {
        sheetCm: sheet.label,
        sheetWidthPx: sheetWPx,
        sheetHeightPx: sheetHPx,
        photosPerSheet: perSheet,
        cols,
        rows,
        sheetsTotal,
      };
    } else {
      // ======== ОБЫЧНЫЙ РЕЖИМ: 1 фото на 1 лист (стандартный размер) ========
      // contain — вписываем фото на лист без обрезки
      for (let i = 0; i < sourcePaths.length; i++) {
        const src = sourcePaths[i];
        if (!fs.existsSync(src)) continue;

        const msgId = pathToMessageId?.[src];
        const photoCopies = (msgId && perPhotoCopies?.[msgId])
          ? perPhotoCopies[msgId]
          : copies;

        for (let copy = 1; copy <= photoCopies; copy++) {
          const copyLabel = photoCopies > 1 ? `_копия${copy}` : '';
          const sizeLabel = size.replace(/[×xхX\*]/g, 'x');
          const fileName = `фото_${i + 1}${copyLabel}_${sizeLabel}.jpg`;
          const outputPath = path.join(outputDir, fileName);

          log(`Resize: ${path.basename(src)} → ${photoWPx}×${photoHPx} contain`);
          const buf = await resizePhoto(src, photoWPx, photoHPx, 'contain');
          await sharp(buf).toFile(outputPath);
          processedFiles.push(outputPath);
        }
      }
    }

    if (processedFiles.length === 0) {
      throw new Error('Ни одно фото не было обработано');
    }

    // ZIP-архив — с номером заказа в имени
    const sizeLabel = size.replace(/[×xхX\*]/g, 'x');
    const archiveName = orderNumber
      ? `заказ_${orderNumber}_${sizeLabel}.zip`
      : `заказ_${sizeLabel}_${Date.now()}.zip`;
    const archivePath = path.join(archiveDir, archiveName);
    const archiveUrl = `/uploads/archives/${archiveName}`;

    await createZipArchive(processedFiles, archivePath, {
      size,
      printType,
      borders,
      photosCount: sourcePaths.length,
      copies,
      layout: layoutInfo,
      orderNumber,
    });

    const archiveStats = fs.statSync(archivePath);
    cleanupDir(outputDir);

    log(`Готово: ${archiveName} (${formatFileSize(archiveStats.size)})`);

    return {
      archivePath,
      archiveUrl,
      processedCount: sourcePaths.length,
      totalFiles: processedFiles.length,
      archiveSize: archiveStats.size,
      details: {
        targetWidthPx: photoWPx,
        targetHeightPx: photoHPx,
        sizeCm: `${parsedSize.w}×${parsedSize.h}`,
        fitMode: layoutInfo ? 'layout' : 'contain',
        layout: layoutInfo,
      },
    };
  } catch (error) {
    cleanupDir(outputDir);
    throw error;
  }
}

// ============================================================================
// Действие: archiveOriginalPhotos
// ============================================================================

async function archiveOriginalPhotos(input) {
  const { sourcePaths, sessionId, orderInfo, orderNumber } = input;

  if (!sourcePaths || sourcePaths.length === 0) {
    throw new Error('Нет фотографий для архивирования');
  }

  const cwd = input.cwd || process.cwd();
  const archiveDir = path.resolve(cwd, 'uploads/archives');
  fs.mkdirSync(archiveDir, { recursive: true });

  const archiveName = orderNumber
    ? `заказ_${orderNumber}_оригиналы.zip`
    : `заказ_${Date.now()}.zip`;
  const archivePath = path.join(archiveDir, archiveName);
  const archiveUrl = `/uploads/archives/${archiveName}`;

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(archivePath);
    const archive = archiver('zip', { zlib: { level: 1 } });

    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);

    for (let i = 0; i < sourcePaths.length; i++) {
      const ext = path.extname(sourcePaths[i]);
      archive.file(sourcePaths[i], { name: `фото_${i + 1}${ext}` });
    }

    const infoText = [
      `Заказ №${orderNumber || '—'}: ${orderInfo.service}`,
      `═══════════════════════════`,
      `Тариф: ${orderInfo.tariff}`,
      `Сумма: ${orderInfo.price}₽`,
      `Фотографий: ${sourcePaths.length} шт.`,
      ``,
      `Дата: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`,
      ``,
      `Фотографии — оригиналы без обработки.`,
    ].join('\n');

    archive.append(infoText, { name: 'info.txt' });
    archive.finalize();
  });

  const archiveStats = fs.statSync(archivePath);
  log(`Архив оригиналов: ${archiveName} (${formatFileSize(archiveStats.size)})`);

  return {
    archivePath,
    archiveUrl,
    photosCount: sourcePaths.length,
    archiveSize: archiveStats.size,
  };
}

// ============================================================================
// Точка входа: чтение JSON из stdin
// ============================================================================

async function main() {
  let inputData = '';

  for await (const chunk of process.stdin) {
    inputData += chunk;
  }

  const input = JSON.parse(inputData);
  const { action } = input;

  log(`Действие: ${action}`);

  let result;

  switch (action) {
    case 'processPhotosForPrint':
      result = await processPhotosForPrint(input);
      break;
    case 'archiveOriginalPhotos':
      result = await archiveOriginalPhotos(input);
      break;
    default:
      throw new Error(`Неизвестное действие: ${action}`);
  }

  // Результат — строго в stdout (JSON)
  process.stdout.write(JSON.stringify({ success: true, result }));
}

main().catch(err => {
  log('ОШИБКА:', err.message);
  process.stdout.write(JSON.stringify({ success: false, error: err.message }));
  process.exit(1);
});
