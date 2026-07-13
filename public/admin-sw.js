self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

function readPushPayload(event) {
  if (!event.data) {
    return {};
  }

  try {
    return event.data.json();
  } catch (error) {
    return {
      body: event.data.text()
    };
  }
}

async function notifyOpenAdminClients(payload) {
  const clientList = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true
  });

  clientList
    .filter(client => client.url.includes('/admin.html'))
    .forEach(client => {
      client.postMessage({
        type: 'malibu-push-received',
        payload
      });
    });
}

async function showPushNotification(payload) {
  const title = payload.title || 'Neue Buchung';
  const body = payload.body || 'Es ist eine neue Malibu SUP Buchung eingegangen.';
  const options = {
    body,
    tag: payload.tag || `malibu-booking-${Date.now()}`,
    renotify: true,
    data: {
      url: payload.url || '/admin.html',
      bookingId: payload.bookingId || null
    }
  };

  await notifyOpenAdminClients(payload).catch(() => {});

  try {
    await self.registration.showNotification(title, options);
  } catch (error) {
    await self.registration.showNotification(title, {
      body,
      data: options.data
    });
  }
}

self.addEventListener('push', event => {
  const payload = readPushPayload(event);
  event.waitUntil(showPushNotification(payload));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  const targetUrl = new URL(event.notification.data?.url || '/admin.html', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        const adminClient = clientList.find(client => client.url.includes('/admin.html'));

        if (adminClient) {
          if (adminClient.url !== targetUrl && 'navigate' in adminClient) {
            return adminClient.navigate(targetUrl)
              .then(client => (client || adminClient).focus());
          }

          return adminClient.focus();
        }

        return self.clients.openWindow(targetUrl);
      })
  );
});
