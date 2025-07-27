// sw.js

// --- LÓGICA DE CACHE (EXISTENTE E INALTERADA) ---
const CACHE_NAME = 'financeiro-pwa-cache-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/style.css',
    '/script.js',
    '/manifest.json',
    '/images/icons/icon-192x192.png',
    'https://unpkg.com/@phosphor-icons/web',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.23/jspdf.plugin.autotable.min.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Cache aberto');
                return cache.addAll(urlsToCache);
            })
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                return response || fetch(event.request);
            })
    );
});

self.addEventListener('activate', event => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

// --- LÓGICA DE NOTIFICAÇÕES (REPARADA E CENTRALIZADA AQUI) ---

// Constantes do Banco de Dados (devem ser as mesmas do script.js)
const DB_NAME = 'FinanceiroPWA_DB';
const DB_VERSION = 3;
const STORES = ['cobrancas', 'fornecedores', 'agenda', 'pessoais'];
let db;

// Funções auxiliares para acessar o IndexedDB de dentro do Service Worker
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onsuccess = event => {
            db = event.target.result;
            resolve(db);
        };
        request.onerror = event => {
            console.error('[SW] Erro ao abrir o banco de dados:', event.target.error);
            reject(event.target.error);
        };
    });
}

function getAllItems(storeName) {
    return new Promise((resolve, reject) => {
        if (!db) return reject("[SW] Banco de dados não inicializado.");
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

function getConfig(key) {
    return new Promise((resolve) => {
        if (!db || !db.objectStoreNames.contains('config')) return resolve(null);
        const transaction = db.transaction(['config'], 'readonly');
        const store = transaction.objectStore('config');
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result ? request.result.value : null);
        request.onerror = () => resolve(null);
    });
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString + 'T00:00:00-03:00');
    return date.toLocaleDateString('pt-BR');
}

function getDaysUntilDue(dateString) {
    if (!dateString) return Infinity;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDate = new Date(dateString + 'T00:00:00-03:00');
    const diffTime = dueDate.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// Função principal que verifica e envia as notificações
async function checkAndSendNotifications() {
    console.log('[SW] Verificando compromissos para notificação...');
    let totalPendingCount = 0; // Inicializa o contador para o badge

    try {
        await initDB();

        const storeConfig = {
            cobrancas: {
                title: 'Cobrança Próxima!',
                getMessage: (item) => `A cobrança de ${item.cliente} no valor de R$ ${item.valor ? item.valor.toFixed(2) : 'N/A'} vence em ${formatDate(item.vencimento)}.`,
                dateField: 'vencimento'
            },
            fornecedores: {
                title: 'Pagamento de Fornecedor Próximo!',
                getMessage: (item) => `O pagamento para ${item.nome} no valor de R$ ${item.valor ? item.valor.toFixed(2) : 'N/A'} vence em ${formatDate(item.vencimento)}.`,
                dateField: 'vencimento'
            },
            agenda: {
                title: 'Compromisso Próximo!',
                getMessage: (item) => `Você tem um compromisso com ${item.cliente} em ${formatDate(item.data)} às ${item.horario}.`,
                dateField: 'data'
            },
            pessoais: {
                title: 'Despesa Pessoal Próxima!',
                getMessage: (item) => `A despesa de ${item.conta} no valor de R$ ${item.valor ? item.valor.toFixed(2) : 'N/A'} vence em ${formatDate(item.vencimento)}.`,
                dateField: 'vencimento'
            },
        };

        for (const storeName in storeConfig) {
            const items = await getAllItems(storeName);
            const config = storeConfig[storeName];
            const alertDays = parseInt(await getConfig(`${storeName}_notif_days`) || 5);
            let storePendingCount = 0; // Contador para a loja atual

            for (const item of items) {
                // Modificado: Se o item tiver um status e for 'pendente'
                // Ou se for da agenda, verifica se a data é futura ou hoje
                const isPending = item.status === 'pendente';
                const isAgendaFutureOrToday = storeName === 'agenda' && getDaysUntilDue(item.data) >= 0;

                if (isPending || isAgendaFutureOrToday) {
                    const daysDue = getDaysUntilDue(item[config.dateField]);

                    // Condição para notificação (e também para contar no badge)
                    // Considera itens que vencem ou têm compromisso dentro do período de alerta
                    // ou que já venceram/passaram (diasDue <= 0), mas ainda estão pendentes
                    if (daysDue <= alertDays && daysDue >= -Infinity) { // Ajustado para contar também itens vencidos
                         // Evitar notificações duplicadas se o item já foi notificado hoje
                        const notificationTag = `${storeName}-${item.id}`;
                        const notifications = await self.registration.getNotifications({tag: notificationTag});
                        if (notifications.length === 0) {
                            const notificationMessage = config.getMessage(item);
                            await self.registration.showNotification(config.title, {
                                body: notificationMessage,
                                icon: '/images/icons/icon-192x192.png',
                                tag: notificationTag
                            });
                        }
                        storePendingCount++; // Incrementa o contador de pendentes para esta categoria
                    }
                }
            }
            totalPendingCount += storePendingCount; // Soma ao total geral
        }

        // Define o badge do aplicativo com a contagem total de itens pendentes
        if ('setAppBadge' in navigator) {
            if (totalPendingCount > 0) {
                await navigator.setAppBadge(totalPendingCount);
                console.log(`[SW] Badge do aplicativo definido para: ${totalPendingCount}`);
            } else {
                await navigator.clearAppBadge();
                console.log('[SW] Badge do aplicativo limpo.');
            }
        } else {
            console.warn('[SW] API Badging não suportada para atualização automática pelo SW.');
        }

    } catch (error) {
        console.error('[SW] Erro durante a verificação de notificações e badge:', error);
    } finally {
        if (db) {
            db.close();
            console.log('[SW] Conexão com o banco de dados fechada.');
        }
    }
}


// Listener para a Sincronização Periódica em Segundo Plano
self.addEventListener('periodicsync', event => {
    if (event.tag === 'check-due-dates') {
        console.log('[SW] Sincronização periódica acionada.');
        event.waitUntil(checkAndSendNotifications());
    }
});

// NOVO: Listener para mensagens da página principal (para badge)
self.addEventListener('message', async (event) => {
    if (event.data && event.data.type === 'SET_BADGE_COUNT') {
        const count = event.data.count;
        if ('setAppBadge' in navigator) {
            try {
                if (count > 0) {
                    await navigator.setAppBadge(count);
                    console.log(`[SW] Badge definido via mensagem da página para: ${count}`);
                } else {
                    await navigator.clearAppBadge();
                    console.log('[SW] Badge limpo via mensagem da página.');
                }
            } catch (error) {
                console.error('[SW] Erro ao definir/limpar o badge via mensagem:', error);
            }
        } else {
            console.warn('[SW] API Badging não suportada para definição via mensagem.');
        }
    }
});


// Listener para cliques na notificação (EXISTENTE E CORRETO)
self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(clientList => {
            for (let i = 0; i < clientList.length; i++) {
                let client = clientList[i];
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('/');
            }
        })
    );
});
