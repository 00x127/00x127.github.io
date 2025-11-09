let fileData = null;
let originalData = null;
let fileName = '';
let selectedByteOffset = null;
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');

uploadZone.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragging');
});
uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragging');
});
uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragging');
    if (e.dataTransfer.files.length) {
        handleFile(e.dataTransfer.files[0]);
    }
});
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) {
        handleFile(e.target.files[0]);
    }
});

function handleFile(file) {
    fileName = file.name;
    const reader = new FileReader();
    reader.onload = (e) => {
        originalData = new Uint8Array(e.target.result);
        fileData = new Uint8Array(originalData);
        displayEditor();
    };
    reader.readAsArrayBuffer(file);
}

function displayEditor() {
    document.getElementById('editorSection').classList.add('active');
    const info = document.getElementById('fileInfo');
    info.innerHTML = `
    <div class="info-card">
    <div class="info-label">Filename</div>
    <div class="info-value">${fileName}</div>
    </div>
    <div class="info-card">
    <div class="info-label">File Size</div>
    <div class="info-value">${formatBytes(fileData.length)}</div>
    </div>
    <div class="info-card">
    <div class="info-label">Format</div>
    <div class="info-value">${detectFormat()}</div>
    </div>
    `;
    displayHex();
}

function displayHex() {
    const viewer = document.getElementById('hexViewer');
    const bytesToShow = Math.min(2048, fileData.length);
    let html = '';
    for (let i = 0; i < bytesToShow; i += 16) {
        const offset = i.toString(16).padStart(8, '0').toUpperCase();
        let bytes = '';
        for (let j = 0; j < 16 && i + j < bytesToShow; j++) {
            const byte = fileData[i + j].toString(16).padStart(2, '0').toUpperCase();
            const selected = (i + j === selectedByteOffset) ? 'selected' : '';
            bytes += `<span class="hex-byte ${selected}" data-offset="${i + j}">${byte}</span> `;
        }
        html += `<div class="hex-row"><span class="hex-offset">${offset}</span><span class="hex-bytes">${bytes}</span></div>`;
    }
    viewer.innerHTML = html;
    document.querySelectorAll('.hex-byte').forEach(el => {
        el.addEventListener('click', function() {
            const offset = parseInt(this.getAttribute('data-offset'));
            selectedByteOffset = offset;
            document.getElementById('byteOffset').value = offset.toString(16).toUpperCase();
            displayHex();
        });
    });
}

function detectFormat() {
    if (fileData.length < 12) return 'Unknown';
    const header = Array.from(fileData.slice(0, 12)).map(b => String.fromCharCode(b)).join('');
    if (header.includes('ftyp')) return 'MP4';
    if (fileData[0] === 0x1A && fileData[1] === 0x45) return 'WebM/Matroska';
    if (header.includes('AVI')) return 'AVI';
    if (header.includes('moov')) return 'MP4 (no ftyp)';
    return 'Unknown';
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function readUint32BE(offset) {
    if (offset + 3 >= fileData.length) {
        console.error(`Read error: offset 0x${offset.toString(16)} out of bounds`);
        return 0;
    }
    return (fileData[offset] << 24) | (fileData[offset + 1] << 16) | (fileData[offset + 2] << 8) | fileData[offset + 3];
}

function writeUint32BE(offset, value) {
    if (offset + 3 >= fileData.length) {
        console.error(`Write error: offset 0x${offset.toString(16)} out of bounds`);
        return false;
    }
    fileData[offset] = (value >>> 24) & 0xFF;
    fileData[offset + 1] = (value >>> 16) & 0xFF;
    fileData[offset + 2] = (value >>> 8) & 0xFF;
    fileData[offset + 3] = value & 0xFF;
    return true;
}

function writeUint64BE(offset, value) {
    if (offset + 7 >= fileData.length) {
        console.error(`Write error: offset 0x${offset.toString(16)} out of bounds`);
        return false;
    }
    const high = Math.floor(value / 0x100000000);
    const low = value >>> 0;
    writeUint32BE(offset, high);
    writeUint32BE(offset + 4, low);
    return true;
}

function findAllBoxes(boxType, startOffset = 0, endOffset = fileData.length, maxDepth = 10) {
    if (maxDepth <= 0) return [];
    const results = [];
    let pos = startOffset;
    while (pos < endOffset - 8) {
        if (pos + 8 > fileData.length) break;
        let boxSize = readUint32BE(pos);
        const type = String.fromCharCode(fileData[pos + 4], fileData[pos + 5], fileData[pos + 6], fileData[pos + 7]);
        let dataOffset = pos + 8;
        if (boxSize === 1) {
            if (pos + 16 > fileData.length) break;
            const high = readUint32BE(pos + 8);
            const low = readUint32BE(pos + 12);
            boxSize = high * 0x100000000 + low;
            dataOffset = pos + 16;
        }
        if (boxSize < 8 || boxSize > fileData.length - pos) {
            pos++;
            continue;
        }
        if (type === boxType) {
            results.push({ offset: pos, dataOffset: dataOffset, size: boxSize, endOffset: pos + boxSize });
        }
        const containerTypes = ['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf'];
        if (containerTypes.includes(type) && boxSize > dataOffset - pos) {
            const subResults = findAllBoxes(boxType, dataOffset, pos + boxSize, maxDepth - 1);
            results.push(...subResults);
        }
        pos += boxSize;
    }
    return results;
}

function findBox(boxType, startOffset = 0, endOffset = fileData.length) {
    const boxes = findAllBoxes(boxType, startOffset, endOffset);
    return boxes.length > 0 ? boxes[0] : null;
}

function modifyDuration() {
    const hours = parseInt(document.getElementById('durationHours').value) || 0;
    const minutes = parseInt(document.getElementById('durationMinutes').value) || 0;
    const seconds = parseInt(document.getElementById('durationSeconds').value) || 0;
    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    if (totalSeconds <= 0) {
        alert('Please enter a valid duration');
        return;
    }
    const moov = findBox('moov');
    if (!moov) {
        alert('ERROR: Could not find moov box. File may not be a valid MP4.');
        return;
    }
    const mvhd = findBox('mvhd', moov.dataOffset, moov.endOffset);
    if (!mvhd) {
        alert('ERROR: Could not find mvhd box');
        return;
    }
    const mvhdVersion = fileData[mvhd.dataOffset];
    const timescaleOffset = mvhdVersion === 0 ? mvhd.dataOffset + 12 : mvhd.dataOffset + 20;
    const durationOffset = mvhdVersion === 0 ? mvhd.dataOffset + 16 : mvhd.dataOffset + 24;
    const timescale = readUint32BE(timescaleOffset);
    if (timescale === 0) {
        alert(`ERROR: Invalid timescale (0) in mvhd at offset 0x${timescaleOffset.toString(16)}`);
        return;
    }
    const newDuration = Math.floor(totalSeconds * timescale);
    if (mvhdVersion === 0) {
        writeUint32BE(durationOffset, newDuration);
    } else {
        writeUint64BE(durationOffset, newDuration);
    }
    let updates = 0;
    const traks = findAllBoxes('trak', moov.dataOffset, moov.endOffset);
    traks.forEach((trak, idx) => {
        const tkhd = findBox('tkhd', trak.dataOffset, trak.endOffset);
        if (tkhd) {
            const version = fileData[tkhd.dataOffset];
            const tkhdDurOffset = version === 0 ? tkhd.dataOffset + 20 : tkhd.dataOffset + 28;
            if (version === 0) {
                writeUint32BE(tkhdDurOffset, newDuration);
            } else {
                writeUint64BE(tkhdDurOffset, newDuration);
            }
            updates++;
        }
        const mdia = findBox('mdia', trak.dataOffset, trak.endOffset);
        if (mdia) {
            const mdhd = findBox('mdhd', mdia.dataOffset, mdia.endOffset);
            if (mdhd) {
                const version = fileData[mdhd.dataOffset];
                const mdhdTimescaleOffset = version === 0 ? mdhd.dataOffset + 12 : mdhd.dataOffset + 20;
                const mdhdDurOffset = version === 0 ? mdhd.dataOffset + 16 : mdhd.dataOffset + 24;
                const trackTimescale = readUint32BE(mdhdTimescaleOffset);
                if (trackTimescale > 0) {
                    const trackDuration = Math.floor(totalSeconds * trackTimescale);
                    if (version === 0) {
                        writeUint32BE(mdhdDurOffset, trackDuration);
                    } else {
                        writeUint64BE(mdhdDurOffset, trackDuration);
                    }
                    updates++;
                }
            }
        }
        const edts = findBox('edts', trak.dataOffset, trak.endOffset);
        if (edts) {
            const elst = findBox('elst', edts.dataOffset, edts.endOffset);
            if (elst && elst.dataOffset + 16 <= fileData.length) {
                const version = fileData[elst.dataOffset];
                const entryCount = readUint32BE(elst.dataOffset + 4);
                for (let i = 0; i < entryCount && elst.dataOffset + 20 + i * (version === 0 ? 12 : 20) < fileData.length; i++) {
                    const entryOffset = elst.dataOffset + 8 + i * (version === 0 ? 12 : 20);
                    const segmentDuration = Math.floor(totalSeconds * timescale);
                    if (version === 0) {
                        writeUint32BE(entryOffset, segmentDuration);
                        writeUint32BE(entryOffset + 4, 0);
                    } else {
                        writeUint64BE(entryOffset, segmentDuration);
                        writeUint64BE(entryOffset + 8, 0);
                    }
                    updates++;
                }
            }
        }
    });
    displayHex();
    alert(`Duration set to ${hours}h ${minutes}m ${seconds}s\nUpdated ${updates} metadata entries.`);
}

function modifyResolution() {
    const width = parseInt(document.getElementById('resWidth').value);
    const height = parseInt(document.getElementById('resHeight').value);
    if (!width || !height || width <= 0 || height <= 0) {
        alert('Please enter valid width and height');
        return;
    }
    const moov = findBox('moov');
    if (!moov) {
        alert('Could not find moov box');
        return;
    }
    const tkhds = findAllBoxes('tkhd', moov.dataOffset, moov.endOffset);
    if (tkhds.length === 0) {
        alert('Could not find any tkhd boxes');
        return;
    }
    tkhds.forEach((tkhd, idx) => {
        const version = fileData[tkhd.dataOffset];
        let widthOffset = version === 0 ? tkhd.dataOffset + 76 : tkhd.dataOffset + 88;
        let heightOffset = version === 0 ? tkhd.dataOffset + 80 : tkhd.dataOffset + 92;
        writeUint32BE(widthOffset, width << 16);
        writeUint32BE(heightOffset, height << 16);
    });
    displayHex();
    alert(`Resolution set to ${width}x${height}\nUpdated ${tkhds.length} tkhd box(es)`);
}

function modifyBitrate() {
    const bitrate = parseInt(document.getElementById('bitrate').value);
    if (!bitrate || bitrate <= 0) {
        alert('Please enter a valid bitrate (kbps)');
        return;
    }
    const bitrateBps = bitrate * 1000;
    let updates = 0;
    let log = '';
    const avc1 = findBox('avc1');
    if (avc1 && avc1.dataOffset + 48 <= fileData.length) {
        writeUint32BE(avc1.dataOffset + 40, bitrateBps);
        writeUint32BE(avc1.dataOffset + 44, bitrateBps);
        log += `avc1: ${bitrate} kbps at 0x${avc1.dataOffset.toString(16)}\n`;
        updates++;
    }
    const mp4a = findBox('mp4a');
    if (mp4a && mp4a.dataOffset + 48 <= fileData.length) {
        writeUint32BE(mp4a.dataOffset + 40, bitrateBps);
        writeUint32BE(mp4a.dataOffset + 44, bitrateBps);
        log += `mp4a: ${bitrate} kbps at 0x${mp4a.dataOffset.toString(16)}\n`;
        updates++;
    }
    const esds = findBox('esds');
    if (esds && esds.dataOffset + 28 <= fileData.length) {
        writeUint32BE(esds.dataOffset + 20, bitrateBps);
        writeUint32BE(esds.dataOffset + 24, bitrateBps);
        log += `esds: ${bitrate} kbps at 0x${esds.dataOffset.toString(16)}\n`;
        updates++;
    }
    displayHex();
    if (updates > 0) {
        alert(`Bitrate set to ${bitrate} kbps\n\nUpdated ${updates} location(s):\n${log}\n\nNote: Many players calculate bitrate from file size and duration instead of reading these fields.`);
    } else {
        alert(`Could not find bitrate fields (avc1/mp4a/esds). This file may use a different structure.`);
    }
}

function modifyFramerate() {
    const fps = parseFloat(document.getElementById('framerate').value);
    if (!fps || fps <= 0) {
        alert('Please enter a valid frame rate');
        return;
    }
    const mdhd = findBox('mdhd');
    if (!mdhd) {
        alert('ERROR: Could not find mdhd box');
        return;
    }
    const version = fileData[mdhd.dataOffset];
    const timescaleOffset = version === 0 ? mdhd.dataOffset + 12 : mdhd.dataOffset + 20;
    const timescale = readUint32BE(timescaleOffset);
    if (timescale === 0) {
        alert('ERROR: Invalid timescale in mdhd');
        return;
    }
    const sampleDuration = Math.floor(timescale / fps);
    const stts = findBox('stts');
    if (!stts) {
        alert('ERROR: Could not find stts box (sample timing)');
        return;
    }
    const entryCount = readUint32BE(stts.dataOffset + 4);
    if (entryCount === 0) {
        alert('ERROR: stts box has no entries');
        return;
    }
    const sampleDurOffset = stts.dataOffset + 12;
    writeUint32BE(sampleDurOffset, sampleDuration);
    displayHex();
    alert(`Frame rate set to ${fps} FPS\n\nUpdated stts box sample duration to ${sampleDuration}\n\nThis only changes timing metadata.`);
}



function modifyTimescale() {
    const timescale = parseInt(document.getElementById('timescale').value);
    if (!timescale || timescale <= 0) {
        alert('Please enter a valid timescale');
        return;
    }
    const moov = findBox('moov');
    if (!moov) {
        alert('ERROR: Could not find moov box');
        return;
    }
    const mvhd = findBox('mvhd', moov.dataOffset, moov.endOffset);
    if (!mvhd) {
        alert('ERROR: Could not find mvhd box');
        return;
    }
    const mvhdVersion = fileData[mvhd.dataOffset];
    const oldTimescaleOffset = mvhdVersion === 0 ? mvhd.dataOffset + 12 : mvhd.dataOffset + 20;
    const durationOffset = mvhdVersion === 0 ? mvhd.dataOffset + 16 : mvhd.dataOffset + 24;
    const oldTimescale = readUint32BE(oldTimescaleOffset);
    const oldDuration = mvhdVersion === 0 ? readUint32BE(durationOffset) :
    (readUint32BE(durationOffset) * 0x100000000 + readUint32BE(durationOffset + 4));
    if (oldTimescale === 0) {
        alert('ERROR: Invalid old timescale found');
        return;
    }
    const totalTime = oldDuration / oldTimescale;
    const newDuration = Math.floor(totalTime * timescale);
    writeUint32BE(oldTimescaleOffset, timescale);
    if (mvhdVersion === 0) {
        writeUint32BE(durationOffset, newDuration);
    } else {
        writeUint64BE(durationOffset, newDuration);
    }
    let updates = 1;
    const mdias = findAllBoxes('mdia', moov.dataOffset, moov.endOffset);
    mdias.forEach((mdia, idx) => {
        const mdhd = findBox('mdhd', mdia.dataOffset, mdia.endOffset);
        if (mdhd) {
            const version = fileData[mdhd.dataOffset];
            const mdhdOldTimescaleOffset = version === 0 ? mdhd.dataOffset + 12 : mdhd.dataOffset + 20;
            const mdhdDurOffset = version === 0 ? mdhd.dataOffset + 16 : mdhd.dataOffset + 24;
            const mdhdOldTimescale = readUint32BE(mdhdOldTimescaleOffset);
            const mdhdOldDuration = version === 0 ? readUint32BE(mdhdDurOffset) :
            (readUint32BE(mdhdDurOffset) * 0x100000000 + readUint32BE(mdhdDurOffset + 4));
            if (mdhdOldTimescale > 0) {
                const mdhdTotalTime = mdhdOldDuration / mdhdOldTimescale;
                const mdhdNewDuration = Math.floor(mdhdTotalTime * timescale);
                writeUint32BE(mdhdOldTimescaleOffset, timescale);
                if (version === 0) {
                    writeUint32BE(mdhdDurOffset, mdhdNewDuration);
                } else {
                    writeUint64BE(mdhdDurOffset, mdhdNewDuration);
                }
                updates++;
            }
        }
    });
    const stts = findBox('stts');
    if (stts) {
        const entryCount = readUint32BE(stts.dataOffset + 4);
        if (entryCount > 0) {
            const oldSampleDuration = readUint32BE(stts.dataOffset + 12);
            if (oldSampleDuration > 0) {
                const oldFps = oldTimescale / oldSampleDuration;
                const newSampleDuration = Math.floor(timescale / oldFps);
                writeUint32BE(stts.dataOffset + 12, newSampleDuration);
                updates++;
            }
        }
    }
    displayHex();
    alert(`Timescale set to ${timescale}\n\nUpdated ${updates} boxes with recalculated durations to preserve timing.\n\nCheck console for full details.`);
}

function editByte() {
    const offsetHex = document.getElementById('byteOffset').value.trim();
    const valueHex = document.getElementById('byteValue').value.trim();
    if (!offsetHex || !valueHex) {
        alert('Please enter both offset and value');
        return;
    }
    try {
        const offset = parseInt(offsetHex, 16);
        const value = parseInt(valueHex, 16);
        if (isNaN(offset) || isNaN(value)) {
            alert('Invalid hex values - use format like "1A2F" for offset and "FF" for value');
            return;
        }
        if (offset < 0 || offset >= fileData.length) {
            alert(`Offset out of range (0 - ${(fileData.length - 1).toString(16).toUpperCase()})`);
            return;
        }
        if (value < 0 || value > 255) {
            alert('Value must be between 00 and FF');
            return;
        }
        fileData[offset] = value;
        selectedByteOffset = offset;
        displayHex();
        alert(`Byte at offset 0x${offset.toString(16).toUpperCase()} set to 0x${value.toString(16).toUpperCase()}`);
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

function downloadModified() {
    const blob = new Blob([fileData.buffer], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modified_' + fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function resetFile() {
    if (confirm('Reset all changes and restore original file?')) {
        fileData = new Uint8Array(originalData);
        selectedByteOffset = null;
        displayHex();
        alert('File reset to original');
    }
}
