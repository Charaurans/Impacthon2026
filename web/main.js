//Llama a la api y manda datos al viewer

const API_URL = "https://api-mock-cesga.onrender.com";
let viewer;

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
        }
        viewer.resize();
    }
};

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
        console.log("Acceso concedido al portal LocalFold");
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
        const status = document.getElementById('status');
        const overlay = document.getElementById('loading-overlay');
        const loadtext = document.getElementById('loading-subtext');
        const preset = document.getElementById('preset-select').value;
        let config = {};

        if (!fasta.startsWith('>')) {
            status.innerText = "Error: El FASTA debe empezar por '>'";
            return;
        }

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

        document.getElementById('log-content').innerHTML = "";
        addLog("Iniciando sesión en nodo de login del CESGA...");

        overlay.style.display = 'flex';

        try {
            addLog(`Configurando job con preset: ${preset.toUpperCase()}`);

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

            addLog(`Job enviado correctamente. ID: ${job_id}`);

            let jobReady = false;
            while (!jobReady) {
                const poll = await fetch(`${API_URL}/jobs/${job_id}/status`);
                const data = await poll.json();

                addLog(`Verificando cola de Slurm... Estado: <span style="color: #00ffcc">${data.status}</span>`);
                loadtext.innerText = `Estado: ${data.status.toUpperCase()}`;
                
                if (data.status === 'COMPLETED'){
                    jobReady = true;
                } else if (data.status === 'FAILED') {
                    throw new Error("Fallo en el clúster");
                } else{ 
                    await new Promise(r => setTimeout(r, 2000));
                }
            }

            addLog("Job completado. Extrayendo archivos PDB y métricas PAE...");

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

            // 2. Lógica de Descarga de PDB
            document.getElementById('btn-download-pdb').onclick = () => {
                const blob = new Blob([results.structural_data.pdb_file], { type: 'text/plain' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `localfold_${results.protein_metadata?.pdb_id || 'sintetica'}.pdb`;
                a.click();
            };

            // 3. Lógica de Descarga de Logs
            document.getElementById('btn-download-logs').onclick = () => {
                const logContent = `LOGS DE EJECUCIÓN - FINIS TERRAE III\n
                Job ID: ${results.job_id}\n
                Timestamp: ${new Date().toISOString()}\n
                Status: COMPLETED\n
                Hardware: NVIDIA A100 80GB\n
                Config: ${document.getElementById('preset-select').value}`;
                
                const blob = new Blob([logContent], { type: 'text/plain' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = "slurm_output.log";
                a.click();
            };

            renderProtein(id, file);

        } catch (err) {
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
    const btnPalette = document.getElementById('btn-palette');
    const colorMenu = document.getElementById('color-menu');

    // Desplegar/ocultar el menú
    btnPalette.onclick = () => {
        colorMenu.classList.toggle('show');
    };

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
};

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

    const viewerContainer = document.getElementById('viewer');
    const sidePanels = document.querySelectorAll('#config, .left-box, #heat-map, #stats, #log-monitor');

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

const viewerContainer = document.getElementById('viewer');

if (viewerContainer != null){ 
    // Cuando el ratón baja (clic) o empieza a mover, detenemos el giro
    viewerContainer.onmousedown = () => {
        viewer.spin(false);
    };
}

const addLog = (message) => {
    const logContent = document.getElementById('log-content');
    const timestamp = new Date().toLocaleTimeString();
    const newLine = document.createElement('div');
    newLine.innerHTML = `<span style="color: #555;">[${timestamp}]</span> ${message}`;
    logContent.appendChild(newLine);
    // Auto-scroll hacia abajo
    document.getElementById('log-monitor').scrollTop = document.getElementById('log-monitor').scrollHeight;
};