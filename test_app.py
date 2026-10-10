from fastapi.testclient import TestClient
from backend.main import app

def run_tests():
    with TestClient(app) as client:
        # 1. Test index.html
        r_index = client.get('/')
        assert r_index.status_code == 200
        print('1. Index HTML: OK (200)')

        # 2. Test references
        r_refs = client.get('/api/references/all')
        assert r_refs.status_code == 200
        refs_data = r_refs.json()
        pt_count = len(refs_data.get('product_types', []))
        g_count = len(refs_data.get('groups', []))
        s_count = len(refs_data.get('seasons', []))
        st_count = len(refs_data.get('season_types', []))
        sz_count = len(refs_data.get('sizes', []))
        print(f'2. References: OK ({pt_count} product types, {g_count} groups, {s_count} seasons, {st_count} season types, {sz_count} sizes)')

        # 3. Test MoySklad status
        r_ms = client.get('/api/moysklad/status')
        assert r_ms.status_code == 200
        print('3. MoySklad status:', r_ms.json().get('message'))

        # 4. Test MoySklad stores and counterparties
        r_stores = client.get('/api/moysklad/stores')
        r_cps = client.get('/api/moysklad/counterparties')
        print(f'4. MoySklad metadata: {len(r_stores.json())} stores, {len(r_cps.json())} counterparties')

        # 5. Test Articul & Formula Batch calculation
        calc_payload = {
            'rows': [
                {
                    'product_type': 'Футболка',
                    'collection': 'AW26',
                    'brand': 'De Luxury',
                    'description': 'Qora rang',
                    'model_code': 'M-101',
                    'quantity': 10,
                    'price_buy': 15.0,
                    'price_sale': 35.0
                }
            ]
        }
        r_calc = client.post('/api/articul/calculate-batch', json=calc_payload)
        assert r_calc.status_code == 200
        calc_res = r_calc.json()['results'][0]
        print('5. Formula calculations:')
        print('   - Category:', calc_res['category'])
        print('   - Group:', calc_res['group_name'])
        print('   - Calculated Articul:', calc_res['calculated_articul'])
        print('   - Full Name:', calc_res['full_name'])
        print('   - Markup %:', calc_res['markup_pct'])
        print('   - Sum Buy:', calc_res['sum_buy'])
        print('   - Sum Sale:', calc_res['sum_sale'])

        # 6. Test Validation
        r_val = client.post('/api/documents/validate', json=calc_payload)
        assert r_val.status_code == 200
        print('6. Validation check: valid =', r_val.json()['valid'])

        # 7. Test Draft Save & Load
        r_draft = client.post('/api/documents/draft', json={'header': {'currency': 'USD'}, 'rows': calc_payload['rows']})
        assert r_draft.status_code == 200
        r_get_draft = client.get('/api/documents/draft')
        assert r_get_draft.status_code == 200
        print('7. Draft Save & Load: OK')

        # 8. Test History
        r_hist = client.get('/api/documents/history')
        assert r_hist.status_code == 200
        print('8. History endpoint: OK')

        print('\nALL SYSTEM TESTS PASSED SUCCESSFULLY! [OK]')

if __name__ == '__main__':
    run_tests()
