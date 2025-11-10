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
        originalData = e.target.result;
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
    if (offset + 3 >= fileData.length) return 0;
    return ((fileData[offset] & 0xFF) << 24) | 
           ((fileData[offset + 1] & 0xFF) << 16) | 
           ((fileData[offset + 2] & 0xFF) << 8) | 
           (fileData[offset + 3] & 0xFF);
}

function writeUint32BE(offset, value) {
    if (offset + 3 >= fileData.length) return false;
    fileData[offset] = (value >>> 24) & 0xFF;
    fileData[offset + 1] = (value >>> 16) & 0xFF;
    fileData[offset + 2] = (value >>> 8) & 0xFF;
    fileData[offset + 3] = value & 0xFF;
    return true;
}

function writeUint64BE(offset, value) {
    if (offset + 7 >= fileData.length) return false;
    const high = Math.floor(value / 4294967296);
    const low = value & 0xFFFFFFFF;
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
        alert('ERROR: Could not find moov box');
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
        alert('ERROR: Invalid timescale');
        return;
    }
    const newDuration = Math.floor(totalSeconds * timescale);
    if (mvhdVersion === 0) {
        writeUint32BE(durationOffset, newDuration);
    } else {
        writeUint64BE(durationOffset, newDuration);
    }
    let updates = 1;
    const traks = findAllBoxes('trak', moov.dataOffset, moov.endOffset);
    traks.forEach(trak => {
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
                for (let i = 0; i < entryCount; i++) {
                    const entrySize = version === 0 ? 12 : 20;
                    const entryOffset = elst.dataOffset + 8 + i * entrySize;
                    if (entryOffset + entrySize > fileData.length) break;
                    const segmentDuration = Math.floor(totalSeconds * timescale);
                    if (version === 0) {
                        writeUint32BE(entryOffset, segmentDuration);
                    } else {
                        writeUint64BE(entryOffset, segmentDuration);
                    }
                    updates++;
                }
            }
        }
    });
    displayHex();
    alert(`Duration set to ${hours}h ${minutes}m ${seconds}s\nUpdated ${updates} entries`);
}

function modifyResolution() {
    const width = parseInt(document.getElementById('resWidth').value);
    const height = parseInt(document.getElementById('resHeight').value);
    if (!width || !height || width <= 0 || height <= 0) {
        alert('Please enter valid dimensions');
        return;
    }
    const tkhds = findAllBoxes('tkhd');
    if (tkhds.length === 0) {
        alert('Could not find tkhd boxes');
        return;
    }
    tkhds.forEach(tkhd => {
        const version = fileData[tkhd.dataOffset];
        const widthOffset = version === 0 ? tkhd.dataOffset + 76 : tkhd.dataOffset + 88;
        const heightOffset = version === 0 ? tkhd.dataOffset + 80 : tkhd.dataOffset + 92;
        writeUint32BE(widthOffset, width << 16);
        writeUint32BE(heightOffset, height << 16);
    });
    displayHex();
    alert(`Resolution set to ${width}x${height}`);
}

function modifyBitrate() {
    const bitrate = parseInt(document.getElementById('bitrate').value);
    if (!bitrate || bitrate <= 0) {
        alert('Please enter valid bitrate');
        return;
    }
    const bitrateBps = bitrate * 1000;
    let updates = 0;
    const avc1 = findBox('avc1');
    if (avc1 && avc1.dataOffset + 48 <= fileData.length) {
        writeUint32BE(avc1.dataOffset + 40, bitrateBps);
        writeUint32BE(avc1.dataOffset + 44, bitrateBps);
        updates++;
    }
    const mp4a = findBox('mp4a');
    if (mp4a && mp4a.dataOffset + 48 <= fileData.length) {
        writeUint32BE(mp4a.dataOffset + 40, bitrateBps);
        writeUint32BE(mp4a.dataOffset + 44, bitrateBps);
        updates++;
    }
    const esds = findBox('esds');
    if (esds && esds.dataOffset + 28 <= fileData.length) {
        writeUint32BE(esds.dataOffset + 20, bitrateBps);
        writeUint32BE(esds.dataOffset + 24, bitrateBps);
        updates++;
    }
    displayHex();
    alert(updates > 0 ? `Bitrate set to ${bitrate} kbps` : 'Could not find bitrate fields');
}

function modifyFramerate() {
    const fps = parseFloat(document.getElementById('framerate').value);
    if (!fps || fps <= 0) {
        alert('Please enter valid FPS');
        return;
    }
    const mdhd = findBox('mdhd');
    if (!mdhd) {
        alert('Could not find mdhd box');
        return;
    }
    const version = fileData[mdhd.dataOffset];
    const timescaleOffset = version === 0 ? mdhd.dataOffset + 12 : mdhd.dataOffset + 20;
    const timescale = readUint32BE(timescaleOffset);
    if (timescale === 0) {
        alert('Invalid timescale');
        return;
    }
    const sampleDuration = Math.floor(timescale / fps);
    const stts = findBox('stts');
    if (!stts) {
        alert('Could not find stts box');
        return;
    }
    const entryCount = readUint32BE(stts.dataOffset + 4);
    if (entryCount === 0) {
        alert('No stts entries');
        return;
    }
    writeUint32BE(stts.dataOffset + 12, sampleDuration);
    displayHex();
    alert(`FPS set to ${fps}`);
}

function modifyFilesize() {
    const size = parseInt(document.getElementById('filesize').value);
    if (!size || size <= 0) {
        alert('Enter valid size');
        return;
    }
    writeUint32BE(0, size);
    displayHex();
    alert('File size header modified');
}

function modifyTimescale() {
    const timescale = parseInt(document.getElementById('timescale').value);
    if (!timescale || timescale <= 0) {
        alert('Enter valid timescale');
        return;
    }
    const moov = findBox('moov');
    if (!moov) {
        alert('Could not find moov');
        return;
    }
    const mvhd = findBox('mvhd', moov.dataOffset, moov.endOffset);
    if (!mvhd) {
        alert('Could not find mvhd');
        return;
    }
    const version = fileData[mvhd.dataOffset];
    const tsOffset = version === 0 ? mvhd.dataOffset + 12 : mvhd.dataOffset + 20;
    const durOffset = version === 0 ? mvhd.dataOffset + 16 : mvhd.dataOffset + 24;
    const oldTs = readUint32BE(tsOffset);
    const oldDur = version === 0 ? readUint32BE(durOffset) :
        (readUint32BE(durOffset) * 0x100000000 + readUint32BE(durOffset + 4));
    if (oldTs === 0) {
        alert('Invalid old timescale');
        return;
    }
    const totalTime = oldDur / oldTs;
    const newDur = Math.floor(totalTime * timescale);
    writeUint32BE(tsOffset, timescale);
    if (version === 0) {
        writeUint32BE(durOffset, newDur);
    } else {
        writeUint64BE(durOffset, newDur);
    }
    let updates = 1;
    const mdias = findAllBoxes('mdia', moov.dataOffset, moov.endOffset);
    mdias.forEach(mdia => {
        const mdhd = findBox('mdhd', mdia.dataOffset, mdia.endOffset);
        if (mdhd) {
            const v = fileData[mdhd.dataOffset];
            const tsOff = v === 0 ? mdhd.dataOffset + 12 : mdhd.dataOffset + 20;
            const durOff = v === 0 ? mdhd.dataOffset + 16 : mdhd.dataOffset + 24;
            const oldTs2 = readUint32BE(tsOff);
            const oldDur2 = v === 0 ? readUint32BE(durOff) :
                (readUint32BE(durOff) * 0x100000000 + readUint32BE(durOff + 4));
            if (oldTs2 > 0) {
                const time = oldDur2 / oldTs2;
                const newDur2 = Math.floor(time * timescale);
                writeUint32BE(tsOff, timescale);
                if (v === 0) {
                    writeUint32BE(durOff, newDur2);
                } else {
                    writeUint64BE(durOff, newDur2);
                }
                updates++;
            }
        }
    });
    displayHex();
    alert(`Timescale set to ${timescale}\nUpdated ${updates} boxes`);
}

function editByte() {
    const offsetHex = document.getElementById('byteOffset').value.trim();
    const valueHex = document.getElementById('byteValue').value.trim();
    if (!offsetHex || !valueHex) {
        alert('Enter both offset and value');
        return;
    }
    const offset = parseInt(offsetHex, 16);
    const value = parseInt(valueHex, 16);
    if (isNaN(offset) || isNaN(value) || offset < 0 || offset >= fileData.length || value < 0 || value > 255) {
        alert('Invalid values');
        return;
    }
    fileData[offset] = value;
    selectedByteOffset = offset;
    displayHex();
}

function downloadModified() {
    const blob = new Blob([fileData], { type: 'video/mp4' });
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
    if (confirm('Reset all changes?')) {
        fileData = new Uint8Array(originalData);
        selectedByteOffset = null;
        displayHex();
    }
}
