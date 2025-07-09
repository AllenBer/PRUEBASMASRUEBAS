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
let cv = null; // Variable para la instancia de OpenCV

// Esta función se llama cuando OpenCV.js ha terminado de cargar
function onOpenCvReady() {
    cv = window.cv; // Asigna la instancia de OpenCV a la variable global 'cv'
    if (cv) {
        console.log("OpenCV.js está listo!");
        // Aquí puedes realizar cualquier inicialización adicional que necesites de OpenCV
    } else {
        console.error("Error al cargar OpenCV.js");
        alert("Hubo un problema al cargar la librería de procesamiento de imágenes.");
    }
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
        .catch((error) => {
            console.error("Error accediendo a la cámara:", error);
            alert("No se pudo acceder a la cámara de este dispositivo. Asegúrate de dar permisos.");
        });
}

// *** Lógica para tomar la foto y ahora procesarla automáticamente ***
function takePhoto() {
    const video = document.getElementById("live-video");
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height); // Dibuja la imagen completa

    closeLiveCamera(); // Cierra la cámara inmediatamente

    // Verifica si OpenCV está cargado
    if (!cv) {
        alert("OpenCV.js no está cargado. No se puede realizar el recorte automático.");
        // Si OpenCV no está listo, puedes guardar la imagen sin procesar o pedir reintentar
        const imageDataURL = canvas.toDataURL("image/jpeg", 0.7);
        scannedImages[currentLiveDoc] = imageDataURL;
        document.getElementById(`preview-${currentLiveDoc}`).src = imageDataURL;
        document.getElementById(`preview-${currentLiveDoc}`).style.display = 'block';
        document.getElementById(`status-${currentLiveDoc}`).textContent = '⚠️'; // Indicador de que no se pudo procesar
        return;
    }

    // Llama a la función de procesamiento automático
    processImageWithOpenCV(canvas, currentLiveDoc);
}


function closeLiveCamera() {
    document.getElementById("live-camera-modal").style.display = "none";
    if (liveStream) {
        liveStream.getTracks().forEach(track => track.stop());
        liveStream = null;
    }
}

// *** NUEVA FUNCIÓN PARA PROCESAR LA IMAGEN CON OPENCV ***
function processImageWithOpenCV(canvasElement, docName) {
    console.log("Iniciando procesamiento con OpenCV.js...");

    let src = cv.imread(canvasElement); // Carga la imagen del canvas en una Mat de OpenCV
    let dst = new cv.Mat();
    let gray = new cv.Mat();
    let blurred = new cv.Mat();
    let canny = new cv.Mat();
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();

    try {
        // 1. Convertir a escala de grises
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

        // 2. Aplicar un desenfoque para suavizar la imagen y reducir el ruido
        cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);

        // 3. Detección de bordes con Canny
        cv.Canny(blurred, canny, 75, 200, 3, false); // Ajustar umbrales si es necesario

        // 4. Encontrar contornos
        cv.findContours(canny, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let maxArea = 0;
        let bestContour = null;

        // 5. Encontrar el contorno más grande que sea aproximadamente un rectángulo de 4 puntos
        for (let i = 0; i < contours.size(); ++i) {
            let contour = contours.get(i);
            let area = cv.contourArea(contour);
            // Solo considerar contornos de un cierto tamaño mínimo para evitar ruido
            if (area < 1000) continue;

            let perimeter = cv.arcLength(contour, true);
            let approx = new cv.Mat();
            cv.approxPolyDP(contour, approx, 0.02 * perimeter, true);

            // Si el contorno tiene 4 puntos y es suficientemente grande (podrías añadir más lógica aquí)
            if (approx.rows === 4) {
                if (area > maxArea) {
                    maxArea = area;
                    bestContour = approx;
                }
            }
            approx.delete();
        }

        if (bestContour) {
            // 6. Preparar los puntos de origen para la transformación de perspectiva
            // Los puntos deben estar en un orden consistente (ej. superior-izquierdo, superior-derecho, inferior-derecho, inferior-izquierdo)
            // Esto es crucial para la corrección de perspectiva. Necesitas ordenarlos.
            let points = [];
            for (let i = 0; i < bestContour.rows; ++i) {
                points.push({ x: bestContour.data32S[i * 2], y: bestContour.data32S[i * 2 + 1] });
            }

            // Función auxiliar para ordenar los 4 puntos (superior-izq, superior-der, inferio-der, inferior-izq)
            function orderPoints(pts) {
                let rect = new Array(4);
                // Suma y diferencia de coordenadas para encontrar las esquinas
                let s = pts.map(p => p.x + p.y);
                let diff = pts.map(p => p.y - p.x);

                rect[0] = pts[s.indexOf(Math.min(...s))]; // Top-left
                rect[2] = pts[s.indexOf(Math.max(...s))]; // Bottom-right
                rect[1] = pts[diff.indexOf(Math.min(...diff))]; // Top-right
                rect[3] = pts[diff.indexOf(Math.max(...diff))]; // Bottom-left

                return rect;
            }

            let orderedPts = orderPoints(points);

            let [tl, tr, br, bl] = orderedPts;

            // Calcular el ancho y alto del nuevo documento "aplanado"
            let widthA = Math.sqrt(Math.pow(br.x - bl.x, 2) + Math.pow(br.y - bl.y, 2));
            let widthB = Math.sqrt(Math.pow(tr.x - tl.x, 2) + Math.pow(tr.y - tl.y, 2));
            let maxWidth = Math.max(parseInt(widthA), parseInt(widthB));

            let heightA = Math.sqrt(Math.pow(tr.x - br.x, 2) + Math.pow(tr.y - br.y, 2));
            let heightB = Math.sqrt(Math.pow(tl.x - bl.x, 2) + Math.pow(tl.y - bl.y, 2));
            let maxHeight = Math.max(parseInt(heightA), parseInt(heightB));

            // Puntos de destino para la transformación (un rectángulo perfecto)
            let destCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
                0, 0,
                maxWidth - 1, 0,
                maxWidth - 1, maxHeight - 1,
                0, maxHeight - 1
            ]);
            let srcCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
                tl.x, tl.y,
                tr.x, tr.y,
                br.x, br.y,
                bl.x, bl.y
            ]);

            // 7. Realizar la transformación de perspectiva
            let M = cv.getPerspectiveTransform(srcCoords, destCoords);
            let dsize = new cv.Size(maxWidth, maxHeight);
            cv.warpPerspective(src, dst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

            // Limpieza de memoria
            srcCoords.delete();
            destCoords.delete();
            M.delete();
            bestContour.delete();

            // 8. Mostrar el resultado
            const finalCanvas = document.createElement('canvas');
            cv.imshow(finalCanvas, dst); // Dibuja la Mat de OpenCV en un nuevo canvas

            const processedDataURL = finalCanvas.toDataURL("image/jpeg", 0.9); // Calidad ajustable

            scannedImages[docName] = processedDataURL;
            document.getElementById(`preview-${docName}`).src = processedDataURL;
            document.getElementById(`preview-${docName}`).style.display = 'block';
            document.getElementById(`status-${docName}`).textContent = '✅'; // Procesado automáticamente
        } else {
            console.warn("No se pudo detectar un documento rectangular. Se guardará la imagen sin procesar.");
            alert("No se detectó un documento claro. Se guardará la imagen completa. Puedes usar la opción 'Recortar (manual)' si es necesario.");
            const originalDataURL = canvasElement.toDataURL("image/jpeg", 0.7);
            scannedImages[docName] = originalDataURL;
            document.getElementById(`preview-${docName}`).src = originalDataURL;
            document.getElementById(`preview-${docName}`).style.display = 'block';
            document.getElementById(`status-${docName}`).textContent = '⚠️'; // Indicador de que no se pudo procesar automáticamente
        }

    } catch (err) {
        console.error("Error durante el procesamiento OpenCV:", err);
        alert("Ocurrió un error al procesar la imagen automáticamente.");
        // En caso de error, guarda la imagen original para que el usuario pueda intentar el recorte manual
        const originalDataURL = canvasElement.toDataURL("image/jpeg", 0.7);
        scannedImages[docName] = originalDataURL;
        document.getElementById(`preview-${docName}`).src = originalDataURL;
        document.getElementById(`preview-${docName}`).style.display = 'block';
        document.getElementById(`status-${docName}`).textContent = '❌';
    } finally {
        // Asegúrate de liberar la memoria de las Mats de OpenCV
        src.delete();
        dst.delete();
        gray.delete();
        blurred.delete();
        canny.delete();
        contours.delete();
        hierarchy.delete();
    }
}

// *** Las funciones de Cropper.js (recorte manual) se mantienen igual por ahora ***
// openCrop: Se mantiene para ofrecer la opción de recorte manual.
function openCrop(docName) {
    const imageSrc = scannedImages[docName];
    if (!imageSrc) {
        alert("Primero escanea la imagen.");
        return;
    }

    currentDocForCrop = docName;
    const cropperImg = document.getElementById("cropper-image");

    document.getElementById("cropper-modal").style.display = "flex";

    if (cropper) {
        cropper.destroy();
        cropper = null;
    }

    cropperImg.src = ""; // Limpiar cualquier imagen previa para forzar el onload

    cropperImg.onload = () => {
        if (cropperImg.src) {
            cropper = new Cropper(cropperImg, {
                viewMode: 1,
                autoCropArea: 0.8,
                responsive: true,
                background: false,
                movable: true,
                zoomable: true
            });
        }
    };
    cropperImg.src = imageSrc;

    cropperImg.onerror = () => {
        console.error("Error cargando la imagen para recortar:", imageSrc);
        alert("Hubo un problema cargando la imagen para recortar.");
        closeCrop();
    };
}


function confirmCrop() {
    if (!cropper) {
        alert("Cropper no está activo.");
        return;
    }

    const canvas = cropper.getCroppedCanvas();
    if (!canvas) {
        alert("No se pudo obtener el área recortada.");
        return;
    }

    const croppedDataUrl = canvas.toDataURL("image/jpeg", 0.9); // Ajustar calidad
    scannedImages[currentDocForCrop] = croppedDataUrl;
    document.getElementById(`preview-${currentDocForCrop}`).src = croppedDataUrl;
    document.getElementById(`status-${currentDocForCrop}`).textContent = '🟩';
    closeCrop();
}

function closeCrop() {
    if (cropper) {
        cropper.destroy();
        cropper = null;
    }
    document.getElementById("cropper-modal").style.display = "none";
}

// Funciones de generación de ZIP y PDF (se mantienen sin cambios)
async function generateZip() {
    const zip = new JSZip();

    Object.entries(scannedImages).forEach(([docName, imageData], index) => {
        const base64 = imageData.split(',')[1];
        zip.file(`${index + 1}_${docName}.jpg`, base64, { base64: true });
    });

    const blob = await zip.generateAsync({ type: 'blob' });
    const sizeMB = blob.size / (1024 * 1024);

    if (sizeMB < 0.5) { // Ajusta este umbral a un valor más realista para pruebas, luego a 4
        alert(`El ZIP pesa solo ${sizeMB.toFixed(2)}MB. Asegúrate de que las imágenes tengan buena calidad y se hayan escaneado.`);
        return;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'DocumentosEscaneados.zip';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url); // Liberar el objeto URL
}

function generatePDFs() {
    const { jsPDF } = window.jspdf;

    Object.entries(scannedImages).forEach(([docName, imageData], index) => {
        const pdf = new jsPDF();
        const imgProps = pdf.getImageProperties(imageData);
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

        pdf.addImage(imageData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
        pdf.save(`${index + 1}_${docName}.pdf`);
    });
}