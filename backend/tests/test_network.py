def test_stations_loaded(net):
    assert "CSMT" in net.stations
    assert "IGP" in net.stations
    assert net.station("KYN").name.startswith("Kalyan")


def test_sections_have_arc_length(net):
    for sec in net.section_list:
        assert sec.length_km > 0
        assert sec.cum_km[0] == 0
        assert abs(sec.cum_km[-1] - sec.length_km) < 1e-6
        assert all(sec.cum_km[i] <= sec.cum_km[i + 1] for i in range(len(sec.cum_km) - 1))


def test_single_line_ghat_present(net):
    ghat = net.section("KSRA-IGP")
    assert ghat is not None
    assert ghat.line == "single"
    assert ghat.capacity == 1


def test_train_polylines_monotonic(net):
    assert len(net.trains) >= 5
    for t in net.trains:
        assert len(t.polyline) == len(t.poly_cum_km)
        assert t.total_km > 0
        assert all(t.poly_cum_km[i] <= t.poly_cum_km[i + 1] for i in range(len(t.poly_cum_km) - 1))
        # route arc-length increases station to station
        assert all(t.cum_dist_km[i] <= t.cum_dist_km[i + 1] for i in range(len(t.cum_dist_km) - 1))


def test_graph_routing(net):
    path = net.shortest_path("CSMT", "IGP")
    assert path[0] == "CSMT" and path[-1] == "IGP"
    assert "KYN" in path
