self.addEventListener('push', event => {
  let payload = {};

  if (event.data) {
    try {
      payload = event.data.json();
    } catch (error) {
      payload = {
        body: event.data.text()
      };
    }
  }

  const title = payload.title || 'Neue Buchung';
  const options = {
    body: payload.body || 'Es ist eine neue Malibu SUP Buchung eingegangen.',
    tag: payload.tag || 'malibu-booking',
    icon: payload.icon || '/favicon.svg',
    badge: payload.badge || '/favicon.svg',
    data: {
      url: payload.url || '/admin.html',
      bookingId: payload.bookingId || null
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
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
