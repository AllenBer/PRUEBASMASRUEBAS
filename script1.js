// scanner_app.js

const documents = [
    "Formato de alta", "Solicitud de empleo", "Copia del acta de nacimiento", "Número de IMSS", "CURP",
    "Copia de comprobante de estudios", "Copia de comprobante de domicilio", "Credencial de elector (Frente)",
    "Credencial de elector (Reverso)", "Guía de entrevista", "Carta de identidad (solo menores)",
    "Permiso firmado por tutor", "Identificación oficial tutor", "Carta responsiva", "Políticas de la empresa",
    "Políticas de propina", "Convenio de manipulaciones", "Convenio de correo electrónico", "Vale de uniforme",
    "Apertura de cuentas", "Contrato laboral", "Responsiva tarjeta de nómina", "Cuenta Santander"
];

const scannedImages = {};
let cropper = null;
let currentDocForCrop = null;
let currentLiveDoc = null;
let liveStream = null;
let cv = null;

function onOpenCvReady() {
    cv = window.cv;
    if (cv) console.log("OpenCV.js está listo!");
    else alert("Error al cargar OpenCV.js");
}

window.onload = () => {
    const container = document.getElementById('document-container');
    documents.forEach((docName, index) => {
        const div = document.createElement('div');
        div.className = 'document-box';
        div.innerHTML = `
            <label>${index + 1}. ${docName}</label><br>
            <button onclick="startLiveCamera('${docName}')">📸 Escanear</button>
            <span id="status-${docName}">❌</span>
            <img id="preview-${docName}" class="image-preview" style="display:none;">
            <button onclick="openCrop('${docName}')">✂️ Recortar (manual)</button>
        `;
        container.appendChild(div);
    });
};

function startLiveCamera(docName) {
    currentLiveDoc = docName;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
        .then((stream) => {
            liveStream = stream;
            document.getElementById("live-video").srcObject = stream;
            document.getElementById("live-camera-modal").style.display = "flex";
        })
        .catch((error) => alert("No se pudo acceder a la cámara."));
}

function closeLiveCamera() {
    document.getElementById("live-camera-modal").style.display = "none";
    if (liveStream) liveStream.getTracks().forEach(track => track.stop());
    liveStream = null;
}

function resizeCanvas(sourceCanvas, maxWidth = 1280, maxHeight = 960) {
    const ratio = Math.min(maxWidth / sourceCanvas.width, maxHeight / sourceCanvas.height, 1);
    const resizedCanvas = document.createElement('canvas');
    resizedCanvas.width = sourceCanvas.width * ratio;
    resizedCanvas.height = sourceCanvas.height * ratio;
    const ctx = resizedCanvas.getContext('2d');
    ctx.drawImage(sourceCanvas, 0, 0, resizedCanvas.width, resizedCanvas.height);
    return resizedCanvas;
}

function takePhoto() {
    const video = document.getElementById("live-video");
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    closeLiveCamera();

    if (!cv) {
        const resized = resizeCanvas(canvas);
        const quality = currentLiveDoc === "Contrato laboral" ? 0.9 : 0.6;
        const imageDataURL = resized.toDataURL("image/jpeg", quality);
        scannedImages[currentLiveDoc] = imageDataURL;
        document.getElementById(`preview-${currentLiveDoc}`).src = imageDataURL;
        document.getElementById(`preview-${currentLiveDoc}`).style.display = 'block';
        document.getElementById(`status-${currentLiveDoc}`).textContent = '⚠️';
        return;
    }
    processImageWithOpenCV(canvas, currentLiveDoc);
}

function processImageWithOpenCV(canvas, docName) {
    let src = cv.imread(canvas);
    let dst = new cv.Mat(); let gray = new cv.Mat(); let blurred = new cv.Mat();
    let canny = new cv.Mat(); let contours = new cv.MatVector(); let hierarchy = new cv.Mat();
    try {
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
        cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
        cv.Canny(blurred, canny, 75, 200, 3, false);
        cv.findContours(canny, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let maxArea = 0; let bestContour = null;
        for (let i = 0; i < contours.size(); ++i) {
            let contour = contours.get(i);
            let area = cv.contourArea(contour);
            if (area < 1000) continue;
            let perimeter = cv.arcLength(contour, true);
            let approx = new cv.Mat();
            cv.approxPolyDP(contour, approx, 0.02 * perimeter, true);
            if (approx.rows === 4 && area > maxArea) {
                maxArea = area;
                bestContour = approx;
            } else approx.delete();
        }

        if (bestContour) {
            const getPoints = () => {
                const pts = [];
                for (let i = 0; i < 4; i++) pts.push({ x: bestContour.data32S[i * 2], y: bestContour.data32S[i * 2 + 1] });
                return pts;
            }
            const orderPoints = (pts) => {
                let rect = new Array(4);
                const s = pts.map(p => p.x + p.y);
                const diff = pts.map(p => p.y - p.x);
                rect[0] = pts[s.indexOf(Math.min(...s))];
                rect[2] = pts[s.indexOf(Math.max(...s))];
                rect[1] = pts[diff.indexOf(Math.min(...diff))];
                rect[3] = pts[diff.indexOf(Math.max(...diff))];
                return rect;
            }
            const [tl, tr, br, bl] = orderPoints(getPoints());
            const width = Math.max(
                Math.hypot(br.x - bl.x, br.y - bl.y),
                Math.hypot(tr.x - tl.x, tr.y - tl.y)
            );
            const height = Math.max(
                Math.hypot(tr.x - br.x, tr.y - br.y),
                Math.hypot(tl.x - bl.x, tl.y - bl.y)
            );

            const dstCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width - 1, 0, width - 1, height - 1, 0, height - 1]);
            const srcCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
            let M = cv.getPerspectiveTransform(srcCoords, dstCoords);
            let dsize = new cv.Size(width, height);
            cv.warpPerspective(src, dst, M, dsize);
            srcCoords.delete(); dstCoords.delete(); M.delete();
            bestContour.delete();

            const canvasOut = resizeCanvas(document.createElement('canvas'));
            if (docName === "Contrato laboral") {
                const gray2 = new cv.Mat();
                const binarized = new cv.Mat();
                cv.cvtColor(dst, gray2, cv.COLOR_RGBA2GRAY, 0);
                cv.threshold(gray2, binarized, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
                cv.imshow(canvasOut, binarized);
                gray2.delete(); binarized.delete();
            } else {
                cv.imshow(canvasOut, dst);
            }
            const quality = docName === "Contrato laboral" ? 0.9 : 0.6;
            const dataURL = canvasOut.toDataURL("image/jpeg", quality);
            scannedImages[docName] = dataURL;
            document.getElementById(`preview-${docName}`).src = dataURL;
            document.getElementById(`preview-${docName}`).style.display = 'block';
            document.getElementById(`status-${docName}`).textContent = '✅';
        }
    } catch (err) {
        console.error("OpenCV error:", err);
        const fallback = resizeCanvas(canvas);
        const dataURL = fallback.toDataURL("image/jpeg", docName === "Contrato laboral" ? 0.9 : 0.6);
        scannedImages[docName] = dataURL;
        document.getElementById(`preview-${docName}`).src = dataURL;
        document.getElementById(`preview-${docName}`).style.display = 'block';
        document.getElementById(`status-${docName}`).textContent = '❌';
    } finally {
        [src, dst, gray, blurred, canny, contours, hierarchy].forEach(mat => mat.delete());
    }
}

function openCrop(docName) {
    const imageSrc = scannedImages[docName];
    if (!imageSrc) return alert("Primero escanea la imagen.");
    currentDocForCrop = docName;
    const cropperImg = document.getElementById("cropper-image");
    document.getElementById("cropper-modal").style.display = "flex";
    if (cropper) cropper.destroy();
    cropperImg.onload = () => {
        cropper = new Cropper(cropperImg, {
            viewMode: 1, autoCropArea: 0.8, responsive: true,
            background: false, movable: true, zoomable: true
        });
    };
    cropperImg.src = imageSrc;
}

function confirmCrop() {
    if (!cropper) return alert("Cropper no está activo.");
    const canvas = cropper.getCroppedCanvas();
    if (!canvas) return alert("No se pudo obtener el área recortada.");
    const quality = currentDocForCrop === "Contrato laboral" ? 0.9 : 0.6;
    const croppedDataUrl = resizeCanvas(canvas).toDataURL("image/jpeg", quality);
    scannedImages[currentDocForCrop] = croppedDataUrl;
    document.getElementById(`preview-${currentDocForCrop}`).src = croppedDataUrl;
    document.getElementById(`status-${currentDocForCrop}`).textContent = '🟩';
    closeCrop();
}

function closeCrop() {
    if (cropper) cropper.destroy();
    cropper = null;
    document.getElementById("cropper-modal").style.display = "none";
}

async function generateZip() {
    const zip = new JSZip();
    Object.entries(scannedImages).forEach(([docName, data], i) => {
        const base64 = data.split(',')[1];
        zip.file(`${i + 1}_${docName}.jpg`, base64, { base64: true });
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    const sizeMB = blob.size / (1024 * 1024);
    if (sizeMB > 4) alert(`ZIP excede 4MB (${sizeMB.toFixed(2)} MB)`);
    else alert(`ZIP generado (${sizeMB.toFixed(2)} MB)`);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'DocumentosEscaneados.zip';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
}

function generatePDFs() {
    const { jsPDF } = window.jspdf;
    Object.entries(scannedImages).forEach(([docName, data], i) => {
        const pdf = new jsPDF();
        const props = pdf.getImageProperties(data);
        const width = pdf.internal.pageSize.getWidth();
        const height = (props.height * width) / props.width;
        pdf.addImage(data, 'JPEG', 0, 0, width, height);
        pdf.save(`${i + 1}_${docName}.pdf`);
    });
}
