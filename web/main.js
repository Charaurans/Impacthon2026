//Llama a la api y manda datos al viewer

const API_URL = "https://api-mock-cesga.onrender.com";
let viewer;

// Esta función se asegura de que el visor se cree en cuanto el DOM esté listo
window.addEventListener('DOMContentLoaded', () => {
    // Inicializar el visor con fondo transparente para que se vea el CSS
    viewer = $3Dmol.createViewer("viewer", { backgroundColor: "transparent" });
    console.log("Visor 3Dmol inicializado");
});

document.getElementById('btn-run').addEventListener('click', async () => {
    const fasta = document.getElementById('fasta').value.trim();
    const status = document.getElementById('status');
    console.log(fasta)

    if (!fasta.startsWith('>')) {
        status.innerText = "Error: El FASTA debe empezar por '>'";
        return;
    }

    try {
        status.innerText = "Enviando al CESGA...";
        const requestBody = {
            "cpus": 8,
            "fasta_filename": "ubiquitin.fasta",
            "fasta_sequence": fasta,
            "gpus": 1,
            "max_runtime_seconds": 3600,
            "memory_gb": 32
        };

        const res = await fetch(`${API_URL}/jobs/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }, // [cite: 88, 107]
            body: JSON.stringify(requestBody) // 
        });
        
        const { job_id } = await res.json();
        console.log("Job ID recibido:", job_id);

        let jobReady = false;
        while (!jobReady) {
            status.innerText = "Simulando clúster (Polling)...";
            const poll = await fetch(`${API_URL}/jobs/${job_id}/status`);
            const data = await poll.json();
            
            console.log("Estado actual:", data.status);
            
            if (data.status === 'COMPLETED') {
                jobReady = true;
            } else if (data.status === 'FAILED') {
                throw new Error("El job falló en el clúster");
            } else {
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
});

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