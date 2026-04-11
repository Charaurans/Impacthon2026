//Llama a la api y manda datos al viewer

const API_URL = "https://api-mock-cesga.onrender.com";
let viewer;
let viewerContainer;
let fullLog ="";
let currentPdbData = null;
let currentPdbId = "sintetica";
let proteinHistory = [];

// --- NAVEGACIÓN SPA ---
const showSection = (sectionId) => {
    document.querySelectorAll('.spa-section').forEach(s => {
        s.classList.remove('active');
        s.style.display = 'none';
    });
    const target = document.getElementById(sectionId);
    target.classList.add('active');
    target.style.display = 'flex';
    
    // Si entramos al dashboard, inicializamos o redimensionamos el visor
    if (sectionId === 'sec-dashboard') {
        if (!viewer) {
            viewer = $3Dmol.createViewer(document.getElementById('viewer'), { backgroundColor: 'transparent' });
            viewerContainer =  document.getElementById('viewer');
        }
        viewer.resize();
    }
};

// Función principal
window.onload = () => {
    const btnLogin = document.getElementById('button-login');
    const btnGuest = document.getElementById('button-guest');
    const btnRun = document.getElementById('button-run');
    const fastaTextArea = document.getElementById('fasta');
    const dropZone = document.getElementById('drop-zone');

    btnLogin.onclick = () => {
        const userField = document.getElementById('username').value;
        const passField = document.getElementById('password').value;

        // CREDENCIALES ÚNICAS: Definimos el usuario y contraseña permitidos
        const USUARIO_VALIDO = "test";
        const PASS_VALIDO = "test";

        if (userField === USUARIO_VALIDO && passField === PASS_VALIDO) {
        console.log("Sesión iniciada");
        showSection('sec-dashboard');
        } else {
            alert("Nombre de usuario o contraseña incorrectos.");
            // Limpiamos los campos para seguridad
            document.getElementById('username').value = "";
            document.getElementById('password').value = "";
        }
    };

    // Si entra como invitado, entra al menu sin más
    btnGuest.onclick = () => showSection('sec-dashboard');

    // Manejo de Envío de Jobs
    btnRun.onclick = async () => {
    const fasta = fastaTextArea.value.trim();
    const overlay = document.getElementById('loading-overlay');
    const loadtext = document.getElementById('loading-subtext');
    const preset = document.getElementById('preset-select').value;
    let config = {};

    // 1. Configuración de Presets
    switch (preset) {
        case 'fast':
            config = { cpus: 4, gpus: 1, memory_gb: 16, max_runtime_seconds: 1800 };
            break;
        case 'high':
            config = { cpus: 16, gpus: 2, memory_gb: 64, max_runtime_seconds: 7200 };
            break;
        default:
            config = { cpus: 8, gpus: 1, memory_gb: 32, max_runtime_seconds: 3600 };
    }

    overlay.style.display = 'flex';

    try {
        addLog(`Configurando renderizado con preset: ${preset.toUpperCase()}`);

        // 2. Envío del Job
        const requestBody = {
            "fasta_filename": "protein_sequence.fasta",
            "fasta_sequence": fasta,
            "cpus": config.cpus,
            "gpus": config.gpus,
            "memory_gb": config.memory_gb,
            "max_runtime_seconds": config.max_runtime_seconds
        };

        const res = await fetch(`${API_URL}/jobs/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody) 
        });

        const { job_id } = await res.json();

        if (job_id === undefined) {
            addLog("Error: El servidor no devolvió un ID de Job. Revisa el FASTA.");
            return;
        }

        addLog(`Comienza el job con ID: ${job_id}`);

        // 3. Polling de Estado
        let jobReady = false;
        let lastStatus = "";

        while (!jobReady) {
            const poll = await fetch(`${API_URL}/jobs/${job_id}/status`);
            const data = await poll.json();
            const currentStatus = data.status;
            
            if (currentStatus !== lastStatus) {
                addLog("Estado del Job: " + currentStatus);
                lastStatus = currentStatus;
            }

            loadtext.innerText = `Estado: ${currentStatus.toUpperCase()}`;
            
            if (currentStatus === 'COMPLETED') {
                jobReady = true;
            } else if (currentStatus === 'FAILED') {
                throw new Error("Fallo en el clúster de computación");
            } else { 
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        addLog("Descargando resultados...");

        // Procesamos la salida del job
        const out = await fetch(`${API_URL}/jobs/${job_id}/outputs`);
        const results = await out.json();

        console.log("Salida bro:", results);
        // Extraemos referencias de los objetos principales
        const meta = results.protein_metadata;
        const structural = results.structural_data;
        const biological = results.biological_data;

        // Conseguimos los textos del html
        const nameText = document.getElementById('name');
        const avgPlddtText = document.getElementById('avg-plddt');
        const solubilityText = document.getElementById('solubility');

        // Extraemos los valores
        const nameValue = meta.protein_name;
        const plddtAvg = structural.confidence.plddt_mean;
        const solubility = biological.solubility_score;

        // Asignamos los valores a los textos
        nameText.innerText = nameValue;
        avgPlddtText.innerText = plddtAvg.toFixed(2);
        solubilityText.innerText = solubility.toFixed(2);

        if(document.getElementById('peso-mol')) {
            document.getElementById('peso-mol').innerText = biological.sequence_properties.molecular_weight_kda.toFixed(2);
        }
        if(document.getElementById('estabilidad')) {
            document.getElementById('estabilidad').innerText = biological.stability_status;
        }
        if(document.getElementById('solubilidad')) {
            document.getElementById('solubilidad').innerText = biological.solubility_prediction;
        }

        // 5. Renderizado de Gráfico de Confianza (pLDDT por residuo)
        if (structural.confidence && structural.confidence.pae_matrix) {
            renderPAEHeatmap(structural.confidence.pae_matrix);
        } else {
            addLog("Aviso: No se encontraron datos de PAE.");
        }
        // 6. Configuración de Descargas
        currentPdbData = structural.pdb_file;
        currentPdbId = meta.pdb_id || "sintetica";

        document.getElementById('btn-download-pdb').onclick = () => {
            if (!currentPdbData) return addLog("SISTEMA: No hay PDB disponible.");
            downloadFile(currentPdbData, `localfold_${currentPdbId}.pdb`);
        };

        document.getElementById('btn-download-logs').onclick = () => {
            if (!fullLog.trim()) return addLog("SISTEMA: Historial vacío.");
            downloadFile(`LOGS DE SESIÓN\n==========\n${fullLog}`, `logs_${Date.now()}.txt`);
        };

        // 7. Renderizado 3D
        renderProtein(currentPdbId, currentPdbData);

        // Guardar en historial después de cargar el 3D
        setTimeout(() => {
            if (viewer) {
                const snapshot = viewer.pngURI();
                addToHistory(currentPdbId, currentPdbData, snapshot);
            }
        }, 1200);

        addLog("Proceso finalizado con éxito.");

    } catch (err) {
        addLog("Ha ocurrido un error: " + err.message);
        console.error(err);
    } finally {
        overlay.style.display = 'none';
    }
};

    dropZone.addEventListener('drop', e => {
        const file = e.dataTransfer.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const content = event.target.result;
                if (content.trim().startsWith('>')) {
                    fastaTextArea.value = content.trim();
                    document.getElementById('status').innerText = `Archivo cargado: ${file.name}`;
                }
            };
            reader.readAsText(file);
        }
    });

    // --- LÓGICA DEL MENÚ DE COLORES ---
    const colorMenu = document.getElementById('color-menu');

    // Aplicar estilos a la proteína según el botón pulsado
    document.querySelectorAll('.color-btn').forEach(btn => {
        btn.onclick = (e) => {
            if (!viewer) return; // Si no hay visor cargado, no hace nada
            
            const scheme = e.target.getAttribute('data-scheme');
            let styleSpec = {};

            switch (scheme) {
                case 'plddt':
                    styleSpec = {
                        cartoon: {
                            colorfunc: (atom) => {
                                if (atom.b >= 90) return "#FF7D45";
                                if (atom.b >= 70) return "#FFD321";
                                if (atom.b >= 50) return "#65CBFF";
                                return "#0053D6";
                            }
                        }
                    };
                    break;
                case 'amino':
                    // Colores por tipo de aminoácido
                    styleSpec = { sphere: { colorscheme: 'amino' } };
                    break;
                case 'ss':
                    // Colores por estructura secundaria (Hélices, láminas, etc.)
                    styleSpec = { cartoon: { colorscheme: 'ssPyMol' } };
                    break;
                case 'element':
                    // Colores estándar (átomos)
                    styleSpec = { stick: { colorscheme: 'Jmol' } };
                    break;
            }

            // Aplicar el nuevo estilo y renderizar
            viewer.setStyle({}, styleSpec);
            viewer.render();
            
            // Opcional: Ocultar el menú tras seleccionar un color
            colorMenu.classList.remove('show');
        };
    });

        // --- LÓGICA DRAG & DROP ---
    ['dragenter', 'dragover'].forEach(name => {
        dropZone.addEventListener(name, e => { 
            e.preventDefault(); 
            e.stopPropagation();
            dropZone.classList.add('dragging'); // Añade clase al entrar
        });
    });

    ['dragleave', 'drop'].forEach(name => {
        dropZone.addEventListener(name, e => { 
            e.preventDefault(); 
            e.stopPropagation();
            dropZone.classList.remove('dragging'); // Quita clase al salir o soltar
        });
    });

    // El evento 'drop' se mantiene igual, pero ahora limpia la clase al final
    dropZone.addEventListener('drop', e => {
        const file = e.dataTransfer.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const content = event.target.result;
                if (content.trim().startsWith('>')) {
                    document.getElementById('fasta').value = content.trim();
                    document.getElementById('status').innerText = `Archivo cargado: ${file.name}`;
                }
            };
            reader.readAsText(file);
        }
    });

    updateHistoryUI();
};

// Función para renderizar una proteina
function renderProtein(pdbId, pdbData) {
    if (!viewer) return;

    viewer.clear(); // Limpiar siempre antes de cargar nueva

    if(!pdbId){
        // Caso: Datos crudos (LocalFold)
        viewer.addModel(pdbData, "pdb");
        applyDefaultStyle();
    } else {
        // Caso: Descarga de PDB
        $3Dmol.download(`pdb:${pdbId}`, viewer, {}, function() {
            applyDefaultStyle();
        });
    }
}

// Función auxiliar para no repetir código de estilo inicial
function applyDefaultStyle() {
    viewer.setStyle({}, {
        cartoon: {
            colorscheme: {
                prop: 'b',           // Usamos la propiedad B-factor (pLDDT)
                gradient: 'rwb',     // Gradiente Rojo -> Blanco -> Azul
                min: 90,             // Ajusta donde empieza el rojo fuerte (ej. pLDDT 30)
                max: 50             // El azul más fuerte será en pLDDT 100
            },
            thickness: 0.6,
        },
    });
    viewer.zoomTo();
    viewer.render();
    viewer.spin(true); // Activa el giro automático

    const sidePanels = document.querySelectorAll('#config, .left-box, #heat-map, #log-monitor, #history');

    // Función para esconder dashboard
    const hideDashboard = () => {
        sidePanels.forEach(panel => panel.classList.add('fade-out'));
        if (viewer) viewer.spin(false); // Detenemos el giro automático al interactuar
    };

    // Función para mostrar dashboard
    const showDashboard = () => {
        sidePanels.forEach(panel => panel.classList.remove('fade-out'));
    };

    // Eventos del ratón sobre el visor
    viewerContainer.addEventListener('mousedown', hideDashboard);
    
    // Al soltar el clic, o si el ratón sale del visor mientras arrastra
    window.addEventListener('mouseup', showDashboard);

    // Soporte para pantallas táctiles (móviles/tablets)
    viewerContainer.addEventListener('touchstart', hideDashboard);
    window.addEventListener('touchend', showDashboard);

    viewer.zoomTo();
    viewer.render();
    viewer.spin(true);
}

// Función para almacenar los logs
const addLog = (message) => {
    const logContent = document.getElementById('log-content');
    const timestamp = new Date().toLocaleTimeString();
    const newLine = document.createElement('div');
    
    // Mostramos los logs por pantalla
    newLine.innerHTML = timestamp + " ";
    newLine.append(message);
    logContent.appendChild(newLine);

    // Guardamos el log en el acumulador
    fullLog += timestamp + " " + message + "\n";

    // Auto-scroll hacia abajo
    document.getElementById('log-monitor').scrollTop = document.getElementById('log-monitor').scrollHeight;
};

// Función auxiliar para actualizar las imagenes de los recientes
const updateHistoryUI = () => {
    const container = document.getElementById('history-container');
    if (!container) return;
    
    container.innerHTML = proteinHistory.map((item, index) => `
        <div class="history-item" onclick="loadFromHistory(${index})">
            <img src="${item.img}" title="${item.name}">
        </div>
    `).join('') + '<div class="history-item empty">Vacío</div>'.repeat(Math.max(0, 3 - proteinHistory.length));
};

// Función auxiliar para añadir una proteína al historial
const addToHistory = (name, pdb, img) => {
    proteinHistory.unshift({ name, pdb, img });
    if (proteinHistory.length > 3) proteinHistory.pop();
    updateHistoryUI();
};

// Función auxiliar para cargar el historial
const loadFromHistory = (index) => {
    const item = proteinHistory[index];
    currentPdbData = item.pdb;
    currentPdbId = item.name;
    renderProtein(item.name, item.pdb);
    addLog(`Restaurada desde historial: ${item.name}`);
};

// Función genérica para descargar archivos
const downloadFile = (content, filename) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
};

function renderPLDDTChart(plddtArray) {
    if (!plddtArray || plddtArray.length === 0) return;

    const trace = {
        x: plddtArray.map((_, i) => i + 1), // Residuo 1, 2, 3...
        y: plddtArray,
        type: 'scatter',
        mode: 'lines',
        line: { color: '#4ade80', width: 2 },
        fill: 'tozeroy', // Relleno hasta el eje X para que parezca una montaña
        fillcolor: 'rgba(74, 222, 128, 0.1)',
        hovertemplate: 
            "<b>Residuo %{x}</b><br>" +
            "Confianza: %{y:.1f}%<br>" +
            "<extra></extra>"
    };

    const layout = {
        margin: { t: 10, r: 10, b: 40, l: 40 },
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { color: '#d1d5db', size: 10 },
        xaxis: { title: 'Posición del Residuo', gridcolor: '#334155' },
        yaxis: { title: 'pLDDT', range: [0, 105], gridcolor: '#334155' },
        shapes: [
            // Línea de referencia en 70 (Umbral de buena calidad)
            { type: 'line', x0: 0, x1: plddtArray.length, y0: 70, y1: 70, 
              line: { color: '#ffea00', width: 1, dash: 'dot' } }
        ]
    };

    Plotly.newPlot('plddt-plot', [trace], layout, { responsive: true, displayModeBar: false });
}

function renderPAEHeatmap(paeMatrix) {
    if (!paeMatrix || paeMatrix.length === 0) return;

    const data = [{
        z: paeMatrix,
        type: 'heatmap',
        colorscale: [
            [0, '#0053D6'],   // Azul (0 Å de error - Excelente)
            [0.2, '#65CBFF'], // Azul claro
            [0.5, '#f8fafc'], // Blanco (Error medio)
            [1, '#ffffff']    // Blanco puro (Error alto > 30 Å)
        ],
        showscale: true,
        colorbar: {
            title: 'Error (Å)',
            titleside: 'top',
            thickness: 10,
            len: 0.5
        },
        hovertemplate: 
            "<b>Relación de Confianza</b><br>" +
            "Residuo i: %{x}<br>" +
            "Residuo j: %{y}<br>" +
            "Error: %{z:.1f} Å<br>" +
            "<extra>Valores bajos (Azul) indican que la posición relativa es muy fiable.</extra>"
    }];

    const layout = {
        margin: { t: 5, r: 5, b: 40, l: 40 },
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { color: '#d1d5db', size: 10 },
        xaxis: { title: 'Residuo i', gridcolor: '#334155' },
        yaxis: { 
            title: 'Residuo j', 
            gridcolor: '#334155',
            autorange: 'reversed' // Crucial para leer la matriz correctamente
        }
    };

    Plotly.newPlot('pae-plot', data, layout, { responsive: true, displayModeBar: false });
}