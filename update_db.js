const sqlite3 = require('sqlite3').verbose();

// Conectar ao banco de dados
const db = new sqlite3.Database('vestibular_alerts.db', (err) => {
    if (err) {
        console.error('Erro ao conectar ao banco de dados:', err.message);
        process.exit(1);
    }
    console.log('Conectado ao banco de dados SQLite.');
});

// Verificar se a coluna password já existe
db.all("PRAGMA table_info(users)", [], (err, rows) => {
    if (err) {
        console.error('Erro ao verificar a estrutura da tabela:', err.message);
        closeDb();
        return;
    }

    console.log('Estrutura da tabela:', rows);

    // Verificar se a coluna password já existe
    const hasPasswordColumn = rows && rows.some(row => row.name === 'password');
    
    if (!hasPasswordColumn) {
        // Adicionar a coluna password
        db.run("ALTER TABLE users ADD COLUMN password TEXT DEFAULT 'senha_temporaria'", (err) => {
            if (err) {
                console.error('Erro ao adicionar coluna password:', err.message);
            } else {
                console.log('Coluna password adicionada com sucesso!');
            }
            closeDb();
        });
    } else {
        console.log('A coluna password já existe na tabela users.');
        closeDb();
    }
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