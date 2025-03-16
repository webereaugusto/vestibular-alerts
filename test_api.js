const http = require('http');

// Função para fazer requisições HTTP
function makeRequest(options, data = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let responseData = '';
            
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            
            res.on('end', () => {
                try {
                    const parsedData = JSON.parse(responseData);
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        data: parsedData
                    });
                } catch (error) {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        data: responseData
                    });
                }
            });
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        if (data) {
            req.write(JSON.stringify(data));
        }
        
        req.end();
    });
}

// Testar o registro de usuário
async function testRegister() {
    console.log('Testando registro de usuário...');
    
    const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/register',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    };
    
    const userData = {
        name: 'Usuário Teste',
        email: 'teste@example.com',
        whatsapp_number: '5511999999999',
        password: 'senha123'
    };
    
    try {
        const response = await makeRequest(options, userData);
        console.log('Resposta do registro:', response);
        return response;
    } catch (error) {
        console.error('Erro ao registrar usuário:', error.message);
        return null;
    }
}

// Testar o login
async function testLogin(email, password) {
    console.log('Testando login...');
    
    const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/login',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    };
    
    const loginData = {
        email,
        password
    };
    
    try {
        const response = await makeRequest(options, loginData);
        console.log('Resposta do login:', response);
        return response;
    } catch (error) {
        console.error('Erro ao fazer login:', error.message);
        return null;
    }
}

// Testar a rota protegida
async function testProtectedRoute(token) {
    console.log('Testando rota protegida...');
    
    const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/users',
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`
        }
    };
    
    try {
        const response = await makeRequest(options);
        console.log('Resposta da rota protegida:', response);
        return response;
    } catch (error) {
        console.error('Erro ao acessar rota protegida:', error.message);
        return null;
    }
}

// Executar os testes
async function runTests() {
    // Testar registro
    const registerResponse = await testRegister();
    
    if (registerResponse && registerResponse.statusCode === 201) {
        const token = registerResponse.data.token;
        const email = 'teste@example.com';
        const password = 'senha123';
        
        // Testar login
        const loginResponse = await testLogin(email, password);
        
        if (loginResponse && loginResponse.statusCode === 200) {
            const loginToken = loginResponse.data.token;
            
            // Testar rota protegida
            await testProtectedRoute(loginToken);
        }
    }
}

// Iniciar os testes
runTests(); 