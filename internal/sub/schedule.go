package sub

import "fmt"

// Zero disables scheduled refreshes; manual updates remain available.
func ValidateUpdateInterval(hours int) error {
	switch hours {
	case 0, 4, 12, 24, 72, 168:
		return nil
	default:
		return fmt.Errorf("update interval must be 0, 4, 12, 24, 72 or 168 hours")
	}
}

func (m *Manager) SetUpdateSchedule(id string, hours int) error {
	if err := ValidateUpdateInterval(hours); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.store.Subscriptions {
		if m.store.Subscriptions[i].ID != id {
			continue
		}
		previous := m.store.Subscriptions[i]
		m.store.Subscriptions[i].AutoUpdate = hours != 0
		m.store.Subscriptions[i].UpdateIntervalHours = hours
		m.store.Subscriptions[i].UpdateIntervalCustomized = true
		if err := m.saveStoreLocked(); err != nil {
			m.store.Subscriptions[i] = previous
			return err
		}
		return nil
	}
	return fmt.Errorf("subscription not found")
}
