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

            const requestBody = {
                "fasta_filename": "ubiquitin.fasta",
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

            if(job_id == undefined){
                addLog("Hay un error en el FASTA");
                return
            }

            addLog(`Comienza el job con ID: ${job_id}`);

            let jobReady = false;
            let lastStatus = "";
            while (!jobReady) {
                const poll = await fetch(`${API_URL}/jobs/${job_id}/status`);
                const data = await poll.json();
                const currentStatus = data.status;
                
                if (currentStatus !== lastStatus) {
                    const color = currentStatus === 'COMPLETED' ? '#4ade80' : '#ffea00';
                    addLog("Estado del Job: " + currentStatus);
                    
                    lastStatus = currentStatus; // Actualizamos el último estado rastreado
                }

                loadtext.innerText = `Estado: ${data.status.toUpperCase()}`;
                
                if (data.status === 'COMPLETED'){
                    jobReady = true;
                } else if (data.status === 'FAILED') {
                    throw new Error("Fallo en el clúster");
                } else{ 
                    await new Promise(r => setTimeout(r, 2000));
                }
            }

            addLog("El renderizado terminará en breves instantes");

            const out = await fetch(`${API_URL}/jobs/${job_id}/outputs`);
            const results = await out.json();
            const id = results.protein_metadata ? results.protein_metadata.pdb_id : null;
            const file = results.structural_data.pdb_file;
            const resultPanel = document.getElementById('result-panel');
            const avgPlddtText = document.getElementById('avg-plddt');
            const paeImage = document.getElementById('pae-image');


            resultPanel.style.display = 'block';

            // Extraer métricas si existen (si no, valores por defecto para sintéticas)
            const plddtAvg = results.structural_data.plddt_avg || "65.4";
            const paeUrl = results.structural_data.pae_image_url || "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Heatmap.png/300px-Heatmap.png";

            avgPlddtText.innerText = plddtAvg;
            paeImage.src = paeUrl;

            // DESCARGAR PDB
            document.getElementById('btn-download-pdb').onclick = () => {
                if (!currentPdbData) return addLog("SISTEMA: No hay PDB disponible.");
                    downloadFile(currentPdbData, `localfold_${currentPdbId}.pdb`);
                };

            // DESCARGAR LOGS
            document.getElementById('btn-download-logs').onclick = () => {
                if (!fullLog.trim()) return addLog("SISTEMA: Historial vacío.");
                    downloadFile(`LOGS DE SESIÓN\n==========\n${fullLog}`, `logs_${Date.now()}.txt`);
                };

            renderProtein(id, file);

            currentPdbData = file;
            currentPdbId = id;

            setTimeout(() => {
                if (viewer) {
                    const snapshot = viewer.pngURI();
                    addToHistory(currentPdbId, currentPdbData, snapshot);
                }
            }, 1000); // 1 segundo de margen para que cargue el 3D

        } catch (err) {
            addLog("Ha ocurrido un error de tipo: " + err.message);
            status.innerText = "Error: " + err.message;
            console.error(err);
        }finally{
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
                    // Tu esquema original basado en AlphaFold/LocalFold
                    styleSpec = {
                        cartoon: {
                            colorfunc: (atom) => {
                                if (atom.b >= 90) return "#0053D6";
                                if (atom.b >= 70) return "#65CBFF";
                                if (atom.b >= 50) return "#FFD321";
                                return "#FF7D45";
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
            colorfunc: (atom) => {
                if (atom.b >= 90) return "#0053D6";
                if (atom.b >= 70) return "#65CBFF";
                if (atom.b >= 50) return "#FFD321";
                return "#FF7D45";                
            }
        }
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