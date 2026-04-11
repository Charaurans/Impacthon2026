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

        if (!fasta.startsWith('>')) {
            status.innerText = "Error: El FASTA debe empezar por '>'";
            return;
        }

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

            status.innerText = "¡Proteína cargada! Su id es el siguiente : " + results.protein_metadata.pdb_id;
            renderProtein(results.protein_metadata.pdb_id);

        } catch (err) {
            status.innerText = "Error: " + err.message;
            console.error(err);
        }
    };

    // --- LÓGICA DRAG & DROP ---
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(name => {
        dropZone.addEventListener(name, e => { e.preventDefault(); e.stopPropagation(); });
    });

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
};

function renderProtein(pdbId) {
    if (!viewer) return;

    // Limpiamos antes de la nueva descarga
    viewer.clear();

    // 3Dmol.download es asíncrono y gestiona la petición por ti
    $3Dmol.download(`pdb:${pdbId}`, viewer, {}, function() {
        viewer.setStyle({}, { cartoon: { color: 'spectrum' } });
        viewer.zoomTo();
        viewer.render();
        console.log("Proteína cargada vía download:", pdbId);
    });
}