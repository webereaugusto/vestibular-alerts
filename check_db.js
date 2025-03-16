const sqlite3 = require('sqlite3').verbose();

// Conectar ao banco de dados
const db = new sqlite3.Database('vestibular_alerts.db', (err) => {
    if (err) {
        console.error('Erro ao conectar ao banco de dados:', err.message);
        process.exit(1);
    }
    console.log('Conectado ao banco de dados SQLite.');
});

// Listar todas as tabelas
db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
    if (err) {
        console.error('Erro ao listar tabelas:', err.message);
        closeDb();
        return;
    }

    console.log('Tabelas existentes:', tables);

    // Se a tabela users existir, verificar sua estrutura
    if (tables.some(table => table.name === 'users')) {
        db.all("PRAGMA table_info(users)", [], (err, columns) => {
            if (err) {
                console.error('Erro ao verificar estrutura da tabela users:', err.message);
                closeDb();
                return;
            }

            console.log('Colunas da tabela users:', columns);
            closeDb();
        });
    } else {
        console.log('A tabela users não existe.');
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