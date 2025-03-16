const sqlite3 = require('sqlite3').verbose();

// Conectar ao banco de dados
const db = new sqlite3.Database('vestibular_alerts.db', (err) => {
    if (err) {
        console.error('Erro ao conectar ao banco de dados:', err.message);
        process.exit(1);
    }
    console.log('Conectado ao banco de dados SQLite.');
});

// Dados de exemplo de vestibulares
const vestibulares = [
    {
        name: 'Vestibular FUVEST 2025',
        institution: 'USP',
        start_registration: '2024-08-12',
        end_registration: '2024-09-10',
        payment_deadline: '2024-09-11',
        exemption_deadline: '2024-07-15',
        first_phase_date: '2024-11-17',
        second_phase_date: '2024-12-15',
        results_date: '2025-01-24',
        first_call_date: '2025-01-31',
        enrollment_date: '2025-02-03',
        second_call_date: '2025-02-07'
    },
    {
        name: 'Vestibular UNICAMP 2025',
        institution: 'UNICAMP',
        start_registration: '2024-07-30',
        end_registration: '2024-08-31',
        payment_deadline: '2024-09-01',
        exemption_deadline: '2024-06-15',
        first_phase_date: '2024-10-20',
        second_phase_date: '2024-11-24',
        results_date: '2025-01-20',
        first_call_date: '2025-01-25',
        enrollment_date: '2025-01-30',
        second_call_date: '2025-02-05'
    },
    {
        name: 'Vestibular UNESP 2025',
        institution: 'UNESP',
        start_registration: '2024-09-01',
        end_registration: '2024-10-10',
        payment_deadline: '2024-10-11',
        exemption_deadline: '2024-08-15',
        first_phase_date: '2024-11-15',
        second_phase_date: '2024-12-10',
        results_date: '2025-01-28',
        first_call_date: '2025-02-01',
        enrollment_date: '2025-02-05',
        second_call_date: '2025-02-10'
    },
    {
        name: 'ENEM 2024',
        institution: 'INEP/MEC',
        start_registration: '2024-05-20',
        end_registration: '2024-06-10',
        payment_deadline: '2024-06-15',
        exemption_deadline: '2024-04-30',
        first_phase_date: '2024-11-03',
        second_phase_date: '2024-11-10',
        results_date: '2025-01-15',
        first_call_date: null,
        enrollment_date: null,
        second_call_date: null
    },
    {
        name: 'Vestibular ITA 2025',
        institution: 'ITA',
        start_registration: '2024-06-15',
        end_registration: '2024-07-31',
        payment_deadline: '2024-08-01',
        exemption_deadline: null,
        first_phase_date: '2024-10-15',
        second_phase_date: '2024-11-05',
        results_date: '2024-12-20',
        first_call_date: '2024-12-22',
        enrollment_date: '2025-01-15',
        second_call_date: '2025-01-20'
    }
];

// Inserir os vestibulares no banco de dados
console.log('Inserindo dados de vestibulares...');

// Primeiro, limpar a tabela
db.run('DELETE FROM vestibulares', [], (err) => {
    if (err) {
        console.error('Erro ao limpar tabela:', err.message);
        closeDb();
        return;
    }
    
    console.log('Tabela vestibulares limpa com sucesso.');
    
    // Inserir cada vestibular
    const insertQuery = `
        INSERT INTO vestibulares (
            name, institution, start_registration, end_registration, 
            payment_deadline, exemption_deadline, first_phase_date, 
            second_phase_date, results_date, first_call_date, 
            enrollment_date, second_call_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    let insertedCount = 0;
    
    vestibulares.forEach((vestibular) => {
        db.run(
            insertQuery, 
            [
                vestibular.name,
                vestibular.institution,
                vestibular.start_registration,
                vestibular.end_registration,
                vestibular.payment_deadline,
                vestibular.exemption_deadline,
                vestibular.first_phase_date,
                vestibular.second_phase_date,
                vestibular.results_date,
                vestibular.first_call_date,
                vestibular.enrollment_date,
                vestibular.second_call_date
            ],
            function(err) {
                if (err) {
                    console.error(`Erro ao inserir vestibular ${vestibular.name}:`, err.message);
                } else {
                    console.log(`Vestibular ${vestibular.name} inserido com ID ${this.lastID}`);
                    insertedCount++;
                    
                    // Se todos foram inseridos, fechar o banco
                    if (insertedCount === vestibulares.length) {
                        console.log(`${insertedCount} vestibulares inseridos com sucesso.`);
                        closeDb();
                    }
                }
            }
        );
    });
});

function closeDb() {
    // Fechar a conexão com o banco de dados
    db.close((err) => {
        if (err) {
            console.error('Erro ao fechar o banco de dados:', err.message);
        } else {
            console.log('Conexão com o banco de dados fechada.');
        }
    });
} 