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

        if (!fasta.startsWith('>')) {
            status.innerText = "Error: El FASTA debe empezar por '>'";
            return;
        }

        overlay.style.display = 'flex';

        try {
            status.innerText = "Enviando al CESGA...";
            const requestBody = {
                "fasta_filename": "ubiquitin.fasta",
                "fasta_sequence": fasta,
            };
            const res = await fetch(`${API_URL}/jobs/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody) 
            });
            const { job_id } = await res.json();
            console.log("Job ID recibido:", job_id);

            let jobReady = false;
            while (!jobReady) {
                const poll = await fetch(`${API_URL}/jobs/${job_id}/status`);
                const data = await poll.json();

                status.innerText = `Estado Actual: ${data.status}`;
                loadtext.innerText = `Estado: ${data.status.toUpperCase()}`;
                
                if (data.status === 'COMPLETED'){
                    jobReady = true;
                } else if (data.status === 'FAILED') {
                    throw new Error("Fallo en el clúster");
                } else{ 
                    await new Promise(r => setTimeout(r, 2000));
                }
            }

            status.innerText = "Descargando estructura PDB...";
            const out = await fetch(`${API_URL}/jobs/${job_id}/outputs`);
            const results = await out.json();
            const id = results.protein_metadata ? results.protein_metadata.pdb_id : null;
            const file = results.structural_data.pdb_file;

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
}

// --- LÓGICA DRAG & DROP ---
const dropZone = document.getElementById('drop-zone');

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