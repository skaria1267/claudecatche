from fastapi import HTTPException, Query


def usage_period(start_at: int | None = Query(None, ge=0),
                 end_at: int | None = Query(None, ge=0)) -> dict:
    if start_at is not None and end_at is not None and start_at > end_at:
        raise HTTPException(status_code=400, detail="起始时间不能晚于结束时间")
    return {"start_at": start_at, "end_at": end_at}


def usage_where(start_at: int | None = None, end_at: int | None = None, *,
                channel_id: int | None = None, account_id: int | None = None,
                alias: str = "") -> tuple[str, list]:
    prefix = f"{alias}." if alias else ""
    clauses, params = [], []
    for column, value, operator in (
        ("channel_id", channel_id, "="), ("account_id", account_id, "="),
        ("request_at", start_at, ">="), ("request_at", end_at, "<="),
    ):
        if value is not None:
            clauses.append(f"{prefix}{column} {operator} ?")
            params.append(value)
    return (" WHERE " + " AND ".join(clauses) if clauses else ""), params
