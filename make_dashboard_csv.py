import pandas as pd

INPUT_CSV = "cargo-theft-all.csv"
OUTPUT_CSV = "cargo-theft-dashboard.csv"

offense_cols = [
    "Offense1_UCR", "Offense2_UCR", "Offense3_UCR", "Offense4_UCR", "Offense5_UCR",
    "Offense6_UCR", "Offense7_UCR", "Offense8_UCR", "Offense9_UCR", "Offense10_UCR"
]

location_cols = [
    "Offense1_Location", "Offense2_Location", "Offense3_Location", "Offense4_Location", "Offense5_Location",
    "Offense6_Location", "Offense7_Location", "Offense8_Location", "Offense9_Location", "Offense10_Location"
]

victim_cols = [
    "VictimType1", "VictimType2", "VictimType3", "VictimType4", "VictimType5",
    "VictimType6", "VictimType7", "VictimType8", "VictimType9"
]

property_cols = [
    "Property1_Desc", "Property2_Desc", "Property3_Desc", "Property4_Desc", "Property5_Desc",
    "Property6_Desc", "Property7_Desc", "Property8_Desc", "Property9_Desc", "Property10_Desc"
]

base_cols = [
    "GEOID",
    "Incident_Date",
    "State",
    "Agency_Cleaned",
    "Stolen_Value_Total"
]

usecols = base_cols + offense_cols + location_cols + victim_cols + property_cols

df = pd.read_csv(INPUT_CSV, dtype=str, usecols=usecols)

def combine_values(row, cols):
    values = []
    for col in cols:
        val = str(row.get(col, "")).strip()
        if val and val.lower() != "nan":
            values.append(val)
    return "|".join(sorted(set(values)))

out = pd.DataFrame()

out["Record_ID"] = range(1, len(df) + 1)
out["GEOID"] = df["GEOID"].fillna("").str.strip()
out["Incident_Date"] = df["Incident_Date"].fillna("").str.strip()
out["State"] = df["State"].fillna("").str.strip()
out["Agency_Cleaned"] = df["Agency_Cleaned"].fillna("").str.strip()
out["Stolen_Value_Total"] = (
    df["Stolen_Value_Total"]
    .fillna("0")
    .astype(str)
    .str.replace("$", "", regex=False)
    .str.replace(",", "", regex=False)
    .str.strip()
)

out["offenses"] = df.apply(lambda r: combine_values(r, offense_cols), axis=1)
out["locations"] = df.apply(lambda r: combine_values(r, location_cols), axis=1)
out["victims"] = df.apply(lambda r: combine_values(r, victim_cols), axis=1)
out["properties"] = df.apply(lambda r: combine_values(r, property_cols), axis=1)

out.to_csv(OUTPUT_CSV, index=False)

print(f"Wrote {OUTPUT_CSV}")
print(f"Original columns used: {len(usecols)}")
print(f"Output rows: {len(out):,}")
print(f"Output columns: {len(out.columns)}")