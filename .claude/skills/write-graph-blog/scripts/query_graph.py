#!/usr/bin/env python3
"""Query the Off Course knowledge graph (kg_entities / kg_relationships) via the
Supabase Management API. Read-only — this script never writes to the graph.

Requires SUPABASE_MANAGEMENT_TOKEN in the environment (source .env.local first).

Usage:
  query_graph.py --search "jordaan"              # find entities by name/summary text
  query_graph.py --type neighborhood             # list entities of one type
  query_graph.py --full jordaan                  # one entity + every relationship touching it
  query_graph.py --types                         # list all entity_type values currently in use
"""
import argparse, json, os, subprocess, sys

PROJECT = "fkylzllxvepmrtqxisrn"


def run_query(sql: str):
    token = os.environ.get("SUPABASE_MANAGEMENT_TOKEN")
    if not token:
        sys.exit("SUPABASE_MANAGEMENT_TOKEN is not set — run `export $(grep -E '^SUPABASE_MANAGEMENT_TOKEN=' .env.local | xargs)` first.")
    payload = json.dumps({"query": sql})
    result = subprocess.run(
        ["curl", "-s", "-X", "POST",
         f"https://api.supabase.com/v1/projects/{PROJECT}/database/query",
         "-H", f"Authorization: Bearer {token}",
         "-H", "Content-Type: application/json",
         "-d", payload],
        capture_output=True, text=True,
    )
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        sys.exit(f"Query failed, raw response: {result.stdout}")


def esc(s: str) -> str:
    return s.replace("'", "''")


def cmd_search(term):
    sql = (
        "select slug, entity_type, name, summary, is_published from kg_entities "
        f"where name ilike '%{esc(term)}%' or summary ilike '%{esc(term)}%' or slug ilike '%{esc(term)}%' "
        "order by entity_type, name;"
    )
    print(json.dumps(run_query(sql), indent=2))


def cmd_type(entity_type):
    sql = f"select slug, name, summary, facts, is_published from kg_entities where entity_type = '{esc(entity_type)}' order by name;"
    print(json.dumps(run_query(sql), indent=2))


def cmd_types():
    sql = "select entity_type, count(*) as total, count(*) filter (where is_published) as published from kg_entities group by entity_type order by entity_type;"
    print(json.dumps(run_query(sql), indent=2))


def cmd_full(slug):
    entity_sql = f"select * from kg_entities where slug = '{esc(slug)}';"
    entity = run_query(entity_sql)
    if not entity:
        sys.exit(f"No entity with slug '{slug}'. Try --search first to find the right slug.")

    rel_sql = (
        "select e1.slug as from_slug, e1.name as from_name, r.relation_type, "
        "e2.slug as to_slug, e2.name as to_name, r.facts "
        "from kg_relationships r "
        "join kg_entities e1 on e1.id = r.from_entity_id "
        "join kg_entities e2 on e2.id = r.to_entity_id "
        f"where e1.slug = '{esc(slug)}' or e2.slug = '{esc(slug)}' "
        "order by from_name, relation_type;"
    )
    relationships = run_query(rel_sql)

    print(json.dumps({"entity": entity[0], "relationships": relationships}, indent=2))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--search", help="find entities by fuzzy text match on name/summary/slug")
    g.add_argument("--type", help="list all entities of one entity_type (e.g. canal, landmark, event)")
    g.add_argument("--full", help="one entity's full facts + every relationship touching it, by slug")
    g.add_argument("--types", action="store_true", help="list all entity_type values currently in the graph, with counts")
    args = p.parse_args()

    if args.search:
        cmd_search(args.search)
    elif args.type:
        cmd_type(args.type)
    elif args.full:
        cmd_full(args.full)
    elif args.types:
        cmd_types()


if __name__ == "__main__":
    main()
